local Produce = { screen = {} }

-- text_highlight. screen.text, but boxed-out
do
    local defaults = {
        text = 'abc',            --string to display
        x = 10,                  --x position
        y = 10,                  --y position
        font_face = 1,           --font face
        font_size = 8,           --font size
        levels = { 4, 15 },      --table of 2 brightness levels, 0-15 (text, highlight box)
        flow = 'right',          --direction for text to flow: 'left', 'right', or 'center'
        font_headroom = 3/8,     --used to calculate height of letters. might need to adjust for non-default fonts
        padding = 1,             --padding around highlight box
        fixed_width = nil,
    }
    defaults.__index = defaults

    function Produce.screen.text_highlight()
        return function(props)
            if crops.device == 'screen' then
                setmetatable(props, defaults)

                if crops.mode == 'redraw' then
                    screen.font_face(props.font_face)
                    screen.font_size(props.font_size)

                    local x, y, flow, v = props.x, props.y, props.flow, props.text
                    local w = props.fixed_width or screen.text_extents(v)
                    local h = props.font_size * (1 - props.font_headroom)

                    if props.levels[2] > 0 then
                        screen.level(props.levels[2])
                        screen.rect(
                            x - props.padding + (props.squish and 1 or 0), 
                            --TODO: the nudge is wierd... fix if including in common lib
                            y - h - props.padding + (props.nudge and 0 or 1),
                            w + props.padding*2 - (props.squish and 1 or 0),
                            h + props.padding*2
                        )
                        screen.fill()
                    end
                
                    screen.move(x, y)
                    screen.level(props.levels[1])

                    if flow == 'left' then screen.text_right(v)
                    else screen.text(v) end
                end
            end
        end
    end
end

-- list_highlight. screen.list, but focused item is boxed-out
do
    local defaults = {
        text = {},               --list of strings to display. non-numeric keys are displayed as labels with thier values. (e.g. { cutoff = value })
        x = 10,                  --x position
        y = 10,                  --y position
        font_face = 1,           --font face
        font_size = 8,           --font size
        margin = 5,              --pixel space betweeen list items
        levels = { 4, 15 },      --table of 2 brightness levels, 0-15 (text, highlight box)
        focus = 2,               --only this index in the resulting list will be highlighted,
        flow = 'right',          --direction of list to flow: 'up', 'down', 'left', 'right'
        font_headroom = 3/8,     --used to calculate height of letters. might need to adjust for non-default fonts
        padding = 1,             --padding around highlight box
        -- font_leftroom = 1/16,
        fixed_width = nil,
    }
    defaults.__index = defaults

    function Produce.screen.list_highlight()
        return function (props)
            if crops.device == 'screen' then
                setmetatable(props, defaults)

                if crops.mode == 'redraw' then
                    screen.font_face(props.font_face)
                    screen.font_size(props.font_size)

                    local x, y, i, flow = props.x, props.y, 1, props.flow

                    local function txt(v)
                        local focus = i == props.focus
                        local w = props.fixed_width or screen.text_extents(v)
                        local h = props.font_size * (1 - props.font_headroom)

                        if focus then
                            screen.level(props.levels[2])
                            screen.rect(
                                x - props.padding, 
                                --TODO: the nudge is wierd... fix if including in common lib
                                y - h - props.padding + (props.nudge and 0 or 1),
                                w + props.padding*2,
                                h + props.padding*2
                            )
                            screen.fill()
                        end
                        
                        screen.move(x, y)
                        screen.level(focus and 0 or props.levels[1])

                        if flow == 'left' then screen.text_right(v)
                        else screen.text(v) end

                        if flow == 'right' then 
                            x = x + w + props.margin
                        elseif flow == 'left' then 
                            x = x - w - props.margin
                        elseif flow == 'down' then 
                            y = y + h + props.margin
                        elseif flow == 'up' then 
                            y = y - h - props.margin
                        end

                        i = i + 1
                    end

                    if #props.text > 0 then for _,v in ipairs(props.text) do txt(v) end
                    else for k,v in pairs(props.text) do txt(k); txt(v) end end
                end
            end
        end
    end
end

-- list_underline. screen.list, but focused item is underlined
do
    local defaults = {
        text = {},               --list of strings to display. non-numeric keys are displayed as labels with thier values. (e.g. { cutoff = value })
        x = 10,                  --x position
        y = 10,                  --y position
        font_face = 1,           --font face
        font_size = 8,           --font size
        margin = 5,              --pixel space betweeen list items
        levels = { 4, 15 },      --table of 2 brightness levels, 0-15 (text, underline)
        focus = 2,               --only this index in the resulting list will be underlined
        flow = 'right',          --direction of list to flow: 'up', 'down', 'left', 'right'
        font_headroom = 3/8,     --used to calculate height of letters. might need to adjust for non-default fonts
        padding = 1,             --padding below text
        -- font_leftroom = 1/16,
        fixed_width = nil,
    }
    defaults.__index = defaults

    function Produce.screen.list_underline()
        return function(props)
            if crops.device == 'screen' then
                setmetatable(props, defaults)

                if crops.mode == 'redraw' then
                    screen.font_face(props.font_face)
                    screen.font_size(props.font_size)

                    local x, y, i, flow = props.x, props.y, 1, props.flow

                    local function txt(v)
                        local focus = i == props.focus
                        local w = props.fixed_width or screen.text_extents(v)
                        local h = props.font_size * (1 - props.font_headroom)

                        if focus then
                            screen.level(props.levels[2])
                            screen.move(flow == 'left' and x-w or x, y + props.padding + 1)
                            screen.line_width(1)
                            screen.line_rel(w, 0)
                            screen.stroke()
                        end
                        
                        screen.move(x, y)
                        screen.level(props.levels[(i == props.focus) and 2 or 1])

                        if flow == 'left' then screen.text_right(v)
                        else screen.text(v) end

                        if flow == 'right' then 
                            x = x + w + props.margin
                        elseif flow == 'left' then 
                            x = x - w - props.margin
                        elseif flow == 'down' then 
                            y = y + h + props.margin
                        elseif flow == 'up' then 
                            y = y - h - props.margin
                        end

                        i = i + 1
                    end

                    if #props.text > 0 then for _,v in ipairs(props.text) do txt(v) end
                    else for k,v in pairs(props.text) do txt(k); txt(v) end end
                end
            end
        end
    end
end

return Produce.screen
