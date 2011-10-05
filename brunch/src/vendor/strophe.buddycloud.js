/*
This library is free software; you can redistribute it and/or modify it
 under the terms of the GNU Lesser General Public License as published
 by the Free Software Foundation; either version 2.1 of the License, or
 (at your option) any later version.
 .
 This library is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser
 General Public License for more details.

  Copyright (c) dodo <dodo@blacksec.org>, 2011

*/

/**
* File: strophe.buddycloud.js
* A Strophe plugin for buddycloud (http://buddycloud.org/wiki/XMPP_XEP).
*/
Strophe.getJidFromNode = function (node) {
    var match = node.match(/\/([^\/]+)\/([^\/]+)\/([^\/]+)/);
    return match.length > 3 ? match[2] : null;
}

Strophe.addConnectionPlugin('buddycloud', {
    _connection: null,

    //The plugin must have the init function.
    init: function(conn) {
        this._connection = conn;

        // checking all required plugins
        ["roster","pubsub","register","disco","dataforms"].forEach(function (plugin) {
            if (conn[plugin] === undefined)
                throw new Error(plugin + " plugin required!");
        });

        Strophe.addNamespace('FORWARD', "urn:xmpp:forward:tmp");
        Strophe.addNamespace('MAM', "urn:xmpp:archive#management");
    },

    // Called by Strophe on connection event
    statusChanged: function (status, condition) {
        var conn = this._connection;
        if (status === Strophe.Status.CONNECTED)
            conn.pubsub.jid = conn.jid;
    },

    connect: function (channelserver) {
        var conn = this._connection;
        this.channels = {jid:channelserver};
        conn.pubsub.connect(channelserver);
    },

    // discovers the inbox service jid from the given domain
    discover: function (domain, success, error, timeout) {
        console.log("discover", domain);
        var conn = this._connection, self = this;
        domain = domain || Strophe.getDomainFromJid(conn.jid);
        conn.disco.items(domain, null, function /*success*/ (stanza) {
            self._onDiscoItems(success, error, timeout, stanza);
        }, error, timeout);
    },

    _onDiscoItems: function (success, error, timeout, stanza) {
        var conn = this._connection, self = this;
        /* Per-item callbacks */
        var itemsPending = 1, done = false;
        var itemSuccess = function(jid) {
            itemsPending--;
            if (!done) {
                done = true;
                success(jid);
            }
        };
        var itemError = function() {
            itemsPending--;
            if (!done && itemsPending < 1) {
                done = true;
                error();
            }
        };

        Strophe.forEachChild(stanza, 'query', function(queryEl) {
            Strophe.forEachChild(queryEl, 'item', function(itemEl) {
                var jid = itemEl.getAttribute('jid');
                if (jid) {
                    conn.disco.info(jid, null,
                        function /*success*/ (stanza) {
                            self._onDiscoInfo(itemSuccess, itemError, timeout, jid, stanza);
                        },
                    itemError, timeout);
                    itemsPending++;
                }
            });
        });
        /* itemsPending initialized with 1 to catch 0 items case */
        itemError();
    },

    _onDiscoInfo: function (success, error, timeout, jid, stanza) {
        var conn = this._connection;
        var queries, i, identity,
            identities = stanza.getElementsByTagName('identity');
        for (i = 0; i < identities.length; i++) {
            identity = identities[i];
            if (identity.getAttribute('category') == "pubsub" &&
                identity.getAttribute('type') == "inbox") {
                return success(jid);
            }
        }
        return error();
    },

    createChannel: function (success, error, timeout) {
        var register, conn = this._connection;
        register = $iq({from:conn.jid, to:this.channels.jid, type:'set'})
            .c('query', {xmlns: Strophe.NS.REGISTER});
        conn.sendIQ(register, success, error, timeout);
    },

    subscribeNode: function (node, succ, err) {
        var conn = this._connection;
        conn.pubsub.subscribe(node, null, succ, err);
    },

    unsubscribeNode: function (node, succ, err) {
        var conn = this._connection;
        conn.pubsub.unsubscribe(node, null, null, succ, err);
    },

    getChannelPosts: function (node, succ, err, timeout) {
        var self = this, conn = this._connection;
        conn.pubsub.items(node,
            function  /*success*/ (stanza) {
                if (succ) self._parsePost(stanza, succ);
            }, self._errorcode(err), timeout);
    },

    /* TODO: what is this for?
     * using code in connector.coffee is commented out
     */
    getChannelPostStream: function (node, succ, err, timeout) {
        this._connection.addHandler(
            this._onChannelPost(succ, err),
            Strophe.NS.PUBSUB, 'iq', 'result', null, null);
        this.getChannelPosts(node, null, null, timeout);
    },

    _onChannelPost: function (succ, err) {
        var self = this;
        return this._iqcbsoup(function (stanza) {
            self._parsePost(stanza, succ);
        },  self._errorcode(err));
    },

    /**
     * Parse *multiple* posts
     *
     * @param el <items/> element that contains <item/> children
     */
    _parsePost: function (el, callback) {
        var posts = [];
        var items = el.getElementsByTagName('item');
        for(var i = 0; i < items.length; i++) {
            var item = items[i];
            /* Get first item child */
            var postEl = null;
            Strophe.forEachChild(item, null, function(child) {
                if (!postEl)
                    postEl = child;
            });

            if (postEl)
                try {
                    var parser = this._postParsers['{' + postEl.namespaceURI + '}' + postEl.nodeName];
                    var post = parser.call(this, postEl);
                    if (post) {
                        if (!post.id)
                            post.id = item.getAttribute('id');
                        posts.push(post);
                    }
                } catch(e) {
                    console.error("Cannot parse post", postEl, e.stack || e);
                }
        }
        callback(posts);
    },

    _postParsers: {
        '{http://www.w3.org/2005/Atom}entry': function(entry) {
            var attr, post;

            // Takes an <item /> element and returns a hash of it's attributes
            post = this._parsetag(entry, "id", "published", "updated");

            // content
            attr = entry.getElementsByTagName("content");
            if (attr.length > 0) {
                attr = attr.item(0);
                post.content = {
                    type: attr.getAttribute("type"),
                    value:attr.textContent,
                };
            }

            // author
            attr = entry.getElementsByTagName("author");
            if (attr.length > 0) {
                post.author = this._parsetag(attr.item(0),
                                             "name", "uri");
                if (post.author.uri)
                    post.author.jid = post.author.uri.replace(/^[^:]+:/,"");
            }

            // geo
            attr = entry.getElementsByTagName("geo");
            if (attr.length > 0)
                post.geo = this._parsetag(attr.item(0),
                                          "country", "locality", "text");

            // in reply to
            var in_reply_tos = entry.getElementsByTagNameNS(Strophe.NS.ATOM_THR, "in-reply-to");
            if (in_reply_tos.length > 0)
                post.in_reply_to = in_reply_tos[0].getAttribute("ref");

            return post;
        },
        '{http://jabber.org/protocol/disco#items}query': function(query) {
            var post = { subscriptions: {} };
            Strophe.forEachChild(query, 'item', function(item) {
                var jid = item.getAttribute('jid'),
                    node = item.getAttribute('node'),
                    subscription = item.getAttributeNS(Strophe.NS.PUBSUB, 'subscription'),
                    affiliation = item.getAttributeNS(Strophe.NS.PUBSUB, 'affiliation'),
                    updated;
                Strophe.forEachChild(item, 'updated', function(updated) {
                    updated = updated.textContent;
                });
                if (jid && node)
                    post.subscriptions[node] = {
                        jid: jid,
                        node: node,
                        subscription: subscription,
                        affiliation: affiliation,
                        updated: updated,
                    };
            });
            return post;
        }
    },

    getMetadata: function (jid, node, succ, err, timeout) {
        var self = this, conn = this._connection;
        if (typeof node === 'function') {
            err = succ;
            succ = node;
            node = jid;
            jid = undefined;
        }
        jid = jid || this.channels.jid;
        conn.disco.info(jid, node,
            function /*success*/ (stanza) {
                if (!succ) return;
                // Flatten the namespaced fields into a hash
                var i,key,field,fields = {}, form = conn.dataforms.parse(stanza);
                for (i = 0; i < form.fields.length; i++) {
                    field = form.fields[i];
                    key = field.variable.replace(/.+#/,'');
                    fields[key] = {
                        value: field.value,
                        label: field.label,
                        type:  field.type,
                    };
                }
                succ(fields);
            }, self._errorcode(err), timeout);
    },

    /**
     * @param start {Date} Optional
     * @param end {Date} Optional
     */
    replayNotifications: function(start, end, success, error) {
        var conn = this._connection;
        var queryAttrs = { xmlns: Strophe.NS.MAM };
        if (start)
            queryAttrs.start = start.toISOString();
        if (end)
            queryAttrs.end = end.toISOString();
        var iq = $iq({ from: conn.jid,
                       to: this.channels.jid,
                       type: 'get' }).
            c('query', queryAttrs);
        conn.sendIQ(iq, success, error);
    },

    /**
     * TODO: filter for sender
     */
    addNotificationListener: function(listener) {
        var that = this;
        var safeListener = function() {
            try {
                listener.apply(that, arguments);
            } catch(e) {
                Strophe.fatal(e.stack || e);
            }
        };
        this._connection.pubsub.addNotificationListener(function(stanza) {
            that._handleNotification(stanza, safeListener);
        });
        this._connection.addHandler(function(stanza) {
            Strophe.forEachChild(stanza, 'forwarded', function(forwarded) {
                Strophe.forEachChild(forwarded, 'message', function(innerStanza) {
                    that._handleNotification(innerStanza, safeListener);
                });
            });
            return true;
        }, Strophe.NS.FORWARD, 'message');
    },

    _handleNotification: function(stanza, listener) {
        var that = this;
        Strophe.forEachChild(stanza, 'event', function(eventEl) {
            Strophe.forEachChild(eventEl, null, function(child) {
                if (child.nodeName === 'subscription') {
                    listener({
                        type: 'subscription',
                        node: child.getAttribute('node'),
                        jid: child.getAttribute('jid'),
                        subscription: child.getAttribute('subscription')
                    });
                } else if (child.nodeName === 'affiliation') {
                    listener({
                        type: 'affiliation',
                        node: child.getAttribute('node'),
                        jid: child.getAttribute('jid'),
                        affiliation: child.getAttribute('affiliation')
                    });
                } else if (child.nodeName === 'items') {
                    that._parsePost(child, function(posts) {
                        listener({
                            type: 'posts',
                            node: child.getAttribute('node'),
                            posts: posts
                        });
                    });
                } else if (child.nodeName === 'configuration') {
                    Strophe.forEachChild(child, 'x', function(x) {
                        var config = {};
                        Strophe.forEachChild(x, 'field', function(field) {
                            var k = field.getAttribute('var'),
                                v = undefined;
                            Strophe.forEachChild(field, 'value', function(value) {
                                if (!v)
                                    v = Strophe.getText(value);
                            });
                            if (k && v)
                                config[k] = v;
                        });
                        if (config.FORM_TYPE === Strophe.NS.PUBSUB_NODE_CONFIG)
                            listener({
                                type: 'config',
                                node: child.getAttribute('node'),
                                config: config
                            });
                    });
		} else
		    console.warn("Unhandled buddycloud event type", child.nodeName);
            });
        });
    },

    // helper

    _errorcode: function (error) {
        return function (stanza) {
            if (!error) return;
            var errors = stanza.getElementsByTagName("error");
            var code = errors.item(0).getAttribute('code');
            error(code);
        };
    },

    _iqcbsoup: function (success, error) {
        return function (stanza) {
            var iqtype = stanza.getAttribute('type');
            if (iqtype == 'result') {
                if (success) success(stanza);
            } else if (iqtype == 'error') {
                if (error) error(stanza);
            } else {
                throw {
                    name: "StropheError",
                    message: "Got bad IQ type of " + iqtype
                };
            }
        };
    },

    _parsetag: function (tag) {
        var attr, res = {};
        Array.prototype.slice.call(arguments,1).forEach(function (name) {
            attr = tag.getElementsByTagName(name);
            if (attr.length > 0)
                res[name] = attr.item(0).textContent;
        });
        return res;
    },

});