/**
 * col2 BrowseView
 */

var BrowseView = Backbone.View.extend({
    el: '#col2',

    initialize: function(options) {
        this.channel = options.channel;
        this.itemViews = [];
        _.bindAll(this, 'render', 'posted', 'updatePostView', 'updateSubscribeView');
        this.render();

        this.channel.bind('change', this.render);
    },

    render: function() {
	this.hookChannelNode();

        this.$('.col-title').text('> ' + this.channel.get('id'));
        $('#c1').text(peek(this.channel, 'geo/future') || '');
        $('#c2').text(peek(this.channel, 'geo/current') || '');
        $('#c3').text(peek(this.channel, 'geo/previous') || '');
    },

    /**
     * why call this from render?
     * * the node could be there already
     * * the node could still sync from the server
     */
    hookChannelNode: function() {
        var that = this;

	/* Got it already? */
	if (this.channelNode)
	    return;

        this.channelNode = this.channel.getNode('channel');
	/* Is there one already? */
	if (!this.channelNode)
	    return;

	/* Attach: */
        var items = this.channelNode.get('items');
	/* Populate with existing items */
	items.forEach(function(item) {
            that.insertView(new BrowseItemView({ item: item }));
        });
	/* Hook future updates */
	items.bind('add', function(item) {
	    console.log('addItem to browseview');
            that.insertView(new BrowseItemView({ item: item }));
        });

	this.channelNode.bind('change', this.updatePostView);
	this.updatePostView();

	this.channelNode.bind('change', this.updateSubscribeView);
	this.updateSubscribeView();
    },

    posted: function() {
	if (this.postView) {
	    this.removeView(this.postView);
	    delete this.postView;
	}

	this.updatePostView();
    },

    updatePostView: function() {
	if (!this.channelNode)
	    return;

	if (!this.channelNode.canPost()) {
	    /* Cannot post; remove: */
	    if (this.postView) {
		this.removeView(this.postView);
		delete this.postView;
	    }
	} else {
	    /* Can post: */
	    if (this.postView) {
		/* Already there */
		return;
	    }

	    this.postView = new BrowsePostView({ node: this.channelNode });
	    this.postView.bind('done', this.posted);
	    this.insertView(this.postView);
	}
    },

    updateSubscribeView: function() {
	if (!this.channelNode)
	    return;

	var subscription = this.channelNode.get('subscription');
console.log('subscription: ' + subscription);
	/* Insertion, because not yet subscribed */
	if (!this.subscribeView && subscription === 'none') {
	    this.subscribeView = new BrowseSubscribeView({ channel: this.channel });
	    this.insertView(this.subscribeView);
	}
	/* Removal, because subscribed */
	if (this.subscribeView && subscription !== 'none') {
	    this.removeView(this.subscribeView);
	    delete this.subscribeView;
	}
    },

    insertView: function(view) {
	/* There's no view for this item, right? FIXME. */
	if (_.any(this.itemViews, function(view1) {
		return view1.item && view.item === view1.item;
	})) {
	    /* Should not happen */
	    console.warn('Not inserting duplicate view for ' + view.item);
	    return;
	}

	/* Look for the least but still more recent item below which to insert */
	var before = $('#col2 h2');
	var published = view.getDate &&
	    view.getDate() ||
	    new Date();
	_.forEach(this.itemViews, function(itemView) {
	    var published1 = itemView &&
			  itemView.getDate &&
			  itemView.getDate();
	    if (published1 && published1 > published) {
		before = itemView.el;
	    }
	});

	/* add to view model & DOM */
        this.itemViews.push(view);
        before.after(view.el);
        /* Views may not have an `el' field before their
         * `initialize()' member is called. We need to trigger
         * binding events again: */
        view.delegateEvents();
    },

    removeView: function(view) {
	this.itemViews = _.without(this.itemViews, view);
	view.remove();
    },

    /**
     * Backbone's remove() just removes this.el, which we don't
     * want. Therefore we don't call the superclass.
     */
    remove: function() {
        this.channel.unbind('change', this.render);
        if (this.postView) {
            this.postView.unbind('done', this.posted);
	}
        _.forEach(this.itemViews, function(itemView) {
            itemView.remove();
        });
    }
});

var BrowseItemView = Backbone.View.extend({
    initialize: function(options) {
        this.item = options.item;
	_.bindAll(this, 'render');
	this.item.bind('change', this.render);

        this.el = $(this.template);
        this.render();
    },

    render: function() {
        this.$('.entry-content p:nth-child(1)').text(this.item.getTextContent());

	var published = this.item.getPublished();
	if (published) {
	    var ago = $('<span></span>');
	    ago.attr('title', isoDateString(published));
	    this.$('.entry-content .meta').append(ago);
	    /* Activate plugin: */
	    ago.timeago();
	}
	/* TODO: add geoloc info */
    },

    /* for view ordering */
    getDate: function() {
	return this.item.getPublished();
    },

    remove: function() {
	Backbone.View.prototype.remove.apply(this, arguments);
	this.item.unbind('change', this.render);
    }
});

$(function() {
      BrowseItemView.prototype.template = $('#browse_entry_template').html();
});

/**
 * Triggers 'done' so BrowseView can remove it on success.
 */
var BrowsePostView = Backbone.View.extend({
    events: {
        'click a.btn2': 'post'
    },

    initialize: function(options) {
        this.node = options.node;
        this.el = $(this.template);
        this.$('textarea')[0].focus();
    },

    /**
     * The item to be posted should always be on top.
     */
    getDate: function() {
	return (new Date()).getTime() + 1E6;
    },

    post: function() {
        var that = this;
        var textarea = this.$('textarea');
        textarea.attr('disabled', 'disabled');
        this.$('a.btn2').hide();
        this.node.post(textarea.val(), function(err) {
            if (err) {
                textarea.removeAttr('disabled');
                that.$('a.btn2').show();
            } else {
                that.trigger('done');
                /* TODO: not subscribed? manual refresh */
            }
        });

        return false;
    },

    remove: function() {
        this.trigger('remove');
        Backbone.View.prototype.remove.apply(this, arguments);
    }
});
$(function() {
      BrowsePostView.prototype.template = $('#browse_post_template').html();
});

/**
 * Triggers 'done' so BrowseView can remove it on success.
 */
var BrowseSubscribeView = Backbone.View.extend({
    events: {
        'click a.btn2': 'subscribe'
    },

    initialize: function(options) {
        this.channel = options.channel;
        this.el = $(this.template);
    },

    /**
     * The item to be posted should always be on top.
     */
    getDate: function() {
	return (new Date()).getTime() + 2E6;
    },

    subscribe: function() {
        var that = this;
        this.$('a.btn2').hide();
	this.$('p').text('Subscribing to this channel...');

	this.channel.subscribe(function(err) {
	    if (!err) {
		that.trigger('done');
	    } else {
		that.$('a.btn2').show();
		that.$('p').text('Error');
	    }
	});

        return false;
    }
});
$(function() {
      BrowseSubscribeView.prototype.template = $('#browse_subscribe_template').html();
});
