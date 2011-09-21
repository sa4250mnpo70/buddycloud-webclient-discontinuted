class exports.BaseView extends Backbone.View
    template: ->
        "<div>"

    initialize: ({@parent}) ->
        @el = $(@template this)
        @el.attr id: @cid

        @delegateEvents()

    render: ->
        oldEl = @el
        @el = $(@template this)
        @el.attr id: @cid
        oldEl?.replaceWith @el

        @delegateEvents()