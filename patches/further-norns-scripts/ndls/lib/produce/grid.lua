local Produce = { grid = {} }

-- integer_trigger. incriment & decriment an integer by triggering two keys
do
    local defaults = {
        state = {1},
        x = 1,                      --x position of the component
        y = 1,                      --y position of the component
        edge = 'rising',            --input edge sensitivity. 'rising' or 'falling'.
        x_next = 1,                 --x position of a key that incriments value
        y_next = 1,                 --y position of a key that incriments value
        x_prev = nil,               --x position of a key that decriments value. nil for no dec
        y_prev = nil,               --y position of a key that decriments value. nil for no dec
        t = 0.1,                    --trigger time
        levels = { 0, 15 },         --brightness levels. expects a table of 2 ints 0-15
        wrap = true,                --wrap value around min/max
        min = 1,                    --min value
        max = 4,                    --max value
        input = function(n, z) end, --input callback, passes last key state on any input
    }
    defaults.__index = defaults

    function Produce.grid.integer_trigger()
        local clk = {}
        local blink = { 0, 0 }

        return function(props)
            if crops.device == 'grid' then 
                setmetatable(props, defaults) 

                if crops.mode == 'input' then 
                    local x, y, z = table.unpack(crops.args) 
                    local nxt = x == props.x_next and y == props.y_next
                    local prev = x == props.x_prev and y == props.y_prev

                    if nxt or prev then
                        if
                            (z == 1 and props.edge == 'rising')
                            or (z == 0 and props.edge == 'falling')
                        then
                            local old = crops.get_state(props.state) or 0
                            local v = old + (nxt and 1 or -1)

                            if props.wrap then
                                while v > props.max do v = v - (props.max - props.min + 1) end
                                while v < props.min do v = v + (props.max - props.min + 1) end
                            end
         
                            v = util.clamp(v, props.min, props.max)
                            if old ~= v then
                                crops.set_state(props.state, v)
                            end
                        end
                        do
                            local i = nxt and 2 or 1

                            if clk[i] then clock.cancel(clk[i]) end

                            blink[i] = 1

                            clk[i] = clock.run(function()
                                clock.sleep(props.t)
                                blink[i] = 0
                                crops.dirty.grid = true
                            end)
                            
                            props.input(i, z)
                        end
                    end
                elseif crops.mode == 'redraw' then 
                    local g = crops.handler 

                    for i = 1,2 do
                        local x = i==2 and props.x_next or props.x_prev
                        local y = i==2 and props.y_next or props.y_prev

                        local lvl = props.levels[blink[i] + 1]

                        if lvl>0 then g:led(x, y, lvl) end
                    end
                end
            end
        end
    end
end

-- pattern_recorder. one-key controller for a pattern_time_extended instance
do
    local default_args = {
        blink_time = 0.25,
    }
    default_args.__index = default_args

    local default_props = {
        x = 1,                           --x position of the component
        y = 1,                           --y position of the component
        pattern = pattern_time.new(),    --pattern_time instance
        varibright = true,
    }
    default_props.__index = default_props

    function Produce.grid.pattern_recorder(args)
        args = args or {}
        setmetatable(args, default_args)

        local downtime = 0
        local lasttime = 0

        local blinking = false
        local blink = 0

        clock.run(function()
            while true do
                if blinking then
                    blink = 1
                    crops.dirty.grid = true
                    clock.sleep(args.blink_time)

                    blink = 0
                    crops.dirty.grid = true
                    clock.sleep(args.blink_time)
                else
                    blink = 0
                    clock.sleep(args.blink_time)
                end
            end
        end)

        return function(props)
            if crops.device == 'grid' then
                setmetatable(props, default_props)

                local pattern = props.pattern

                if crops.mode == 'input' then
                    local x, y, z = table.unpack(crops.args)

                    if x == props.x and y == props.y then
                        if z==1 then
                            downtime = util.time()
                        else
                            local theld = util.time() - downtime
                            local tlast = util.time() - lasttime
                            
                            if theld > 0.5 then --hold to clear
                                pattern:stop()
                                pattern:clear()
                                blinking = false
                            else
                                if pattern.data.count > 0 then
                                    if tlast < 0.3 then --double-tap to overdub
                                        pattern:resume()
                                        pattern:set_overdub(1)
                                        blinking = true
                                    else
                                        if pattern.rec == 1 then --play pattern / stop inital recording
                                            pattern:rec_stop()
                                            pattern:start()
                                            blinking = false
                                        elseif pattern.overdub == 1 then --stop overdub
                                            pattern:set_overdub(0)
                                            blinking = false
                                        else
                                            if pattern.play == 0 then --resume pattern
                                                pattern:resume()
                                                blinking = false
                                            elseif pattern.play == 1 then --pause pattern
                                                pattern:stop() 
                                                blinking = false
                                            end
                                        end
                                    end
                                else
                                    if pattern.rec == 0 then --begin initial recording
                                        pattern:rec_start()
                                        blinking = true
                                    else
                                        pattern:rec_stop()
                                        blinking = false
                                    end
                                end
                            end

                            crops.dirty.grid = true
                            lasttime = util.time()
                        end
                    end
                elseif crops.mode == 'redraw' then
                    local g = crops.handler

                    local lvl
                    do
                        local off = 0
                        local dim = (props.varibright == false) and 0 or 4
                        local med = (props.varibright == false) and 15 or 4
                        -- local medhi = (props.varibright == false) and 15 or 8 
                        local hi = 15

                        local empty = 0
                        -- local armed = ({ off, med })[blink + 1]
                        local armed = med
                        local recording = ({ off, med })[blink + 1]
                        local playing = hi
                        local paused = dim
                        local overdubbing = ({ dim, hi })[blink + 1]

                        lvl = (
                            pattern.rec==1 and (pattern.data.count>0 and recording or armed)
                            or (
                                pattern.data.count>0 and (
                                    pattern.overdub==1 and overdubbing
                                    or pattern.play==1 and playing
                                    or paused
                                ) or empty
                            )
                        )
                    end

                    if lvl>0 then g:led(props.x, props.y, lvl) end
                end
            end
        end
    end
end

-- multitrigger. separate actions for short press, long press, and douple tap
do
    local defaults = {
        x = 1,                          --x position of the component
        y = 1,                          --y position of the component
        levels = { 0, 15 },             --brightness levels. expects a table of 2 ints 0-15
        action_tap = function() end,
        action_double_tap = function() end,
        action_hold = function() end,
    }
    defaults.__index = defaults

    local holdtime = 0.5
    local dtaptime = 0.25

    function Produce.grid.multitrigger()
        local blink_clk
        local blink = 0
        
        local downtime = 0
        local lasttime = 0
        
        local tap_clk

        local function single_blink(time)
            if blink_clk then clock.cancel(blink_clk) end

            blink_clk = clock.run(function()
                blink = 1
                crops.dirty.grid = true

                clock.sleep(time)
                blink = 0
                crops.dirty.grid = true
            end)
        end

        local function double_blink()
            if blink_clk then clock.cancel(blink_clk) end

            blink_clk  = clock.run(function()
                blink = 1
                crops.dirty.grid = true

                clock.sleep(0.2)
                blink = 0
                crops.dirty.grid = true

                clock.sleep(0.1)
                blink = 1
                crops.dirty.grid = true

                clock.sleep(0.2)
                blink = 0
                crops.dirty.grid = true
            end)
        end

        return function(props)
            if crops.device == 'grid' then
                setmetatable(props, defaults)

                if crops.mode == 'input' then
                    local x, y, z = table.unpack(crops.args)

                    if x == props.x and y == props.y then
                        if z==1 then
                            downtime = util.time()
                        elseif z==0 then
                            local theld = util.time() - downtime
                            local tlast = util.time() - lasttime
                                
                            if tap_clk then clock.cancel(tap_clk) end

                            if theld > holdtime then
                                props.action_hold()
                                single_blink(0.8)
                            else
                                if tlast < dtaptime then
                                    props.action_double_tap()
                                    double_blink()
                                else
                                    -- tap_clk = clock.run(function() 
                                    --     clock.sleep(0.2)

                                        props.action_tap()
                                        single_blink(dtaptime)
                                    -- end)
                                end
                            end

                            lasttime = util.time()
                        end
                    end
                elseif crops.mode == 'redraw' then
                    local g = crops.handler

                    local lvl = props.levels[blink + 1]

                    if lvl>0 then g:led(props.x, props.y, lvl) end
                end
            end
        end
    end
end

return Produce.grid
