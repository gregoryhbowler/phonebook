local Pattern_time_extended = { grid = {} }

--keymap_poly. based on Grid.momentaires. uses pattern hooks to handle some edge cases that lead to hung notes or other wierdness. polyphonic version.
do
    local default_args = {
        action_on = function(idx) end,   --callback on key pressed, recieves key index (1 - size)
        action_off = function(idx) end,  --callback on key released, recieves key index (1 - size)
        size = 128,                      --number of keys in component (same as momentaires.size)
        pattern = nil,                   --instance of pattern_time_extended or mute_group. process 
                                         --    and hooks will be overwritten
    }
    default_args.__index = default_args

    local default_props = {
        x = 1,                           --x position of the component
        y = 1,                           --y position of the component
        levels = { 0, 15 },              --brightness levels. expects a table of 2 ints 0-15
        input = function(n, z) end,      --input callback, passes last key state on any input
        wrap = 16,                       --wrap to the next row/column every n keys
        flow = 'right',                  --primary direction to flow: 'up', 'down', 'left', 'right'
        flow_wrap = 'down',              --direction to flow when wrapping. must be perpendicular to flow
        padding = 0,                     --add blank spaces before the first key
                                         --note the lack of state prop – this is handled internally
    }
    default_props.__index = default_props

    function Pattern_time_extended.grid.keymap_poly(args)
        args = args or {}
        setmetatable(args, default_args)

        local state = {{}}

        local set_keys = function(value)
            local news, olds = value, state[1]
            
            for i = 1, args.size do
                local new = news[i] or 0
                local old = olds[i] or 0

                if new==1 and old==0 then args.action_on(i)
                elseif new==0 and old==1 then args.action_off(i) end
            end

            state[1] = value
            crops.dirty.grid = true
            crops.dirty.screen = true
        end

        -- local set_keys_wr = multipattern.wrap(args.multipattern, args.id, set_keys)

        args.pattern.process = set_keys
        local set_keys_wr = function(value)
            set_keys(value)
            args.pattern:watch(value)
        end

        state[2] = set_keys_wr

        local clear = function() set_keys({}) end
        local snapshot = function()
            local has_keys = false
            for i = 1, args.size do if (state[1][i] or 0) > 0 then  
                has_keys = true; break
            end end

            if has_keys then set_keys_wr(state[1]) end
        end

        local handlers = {
            pre_clear = clear,
            pre_rec_stop = snapshot,
            post_rec_start = snapshot,
            post_stop = clear,
        }

        args.pattern:set_all_hooks(handlers)
    
        local _momentaries = Grid.momentaries()

        return function(props)
            setmetatable(props, default_props)

            props.size = args.size
            props.state = state

            _momentaries(props)
        end
    end
end

--keymap_mono. based on Grid.momentaires. uses pattern hooks to handle some edge cases that lead to hung notes or other wierdness. monophonic version.
do
    local default_args = {
        action = function(idx, gate) end,--callback key press/release, recieves key index (1 - size)
                                         --    and gate (0 or 1)
        size = 128,                      --number of keys in component (same as momentaires.size)
        pattern = nil,                   --instance of pattern_time_extended or mute_group. process 
                                         --    and hooks will be overwritten
    }
    default_args.__index = default_args

    local default_props = {
        x = 1,                           --x position of the component
        y = 1,                           --y position of the component
        levels = { 0, 15 },              --brightness levels. expects a table of 2 ints 0-15
        input = function(n, z) end,      --input callback, passes last key state on any input
        wrap = 16,                       --wrap to the next row/column every n keys
        flow = 'right',                  --primary direction to flow: 'up', 'down', 'left', 'right'
        flow_wrap = 'down',              --direction to flow when wrapping. must be perpendicular to flow
        padding = 0,                     --add blank spaces before the first key
                                         --note the lack of state prop – this is handled internally
    }
    default_props.__index = default_props

    function Pattern_time_extended.grid.keymap_mono(args)
        args = args or {}
        setmetatable(args, default_args)

        local state_momentaries = {{}}
        local state_integer = {1} 
        local state_gate = {0}

        local function set_idx_gate(idx, gate)
            state_integer[1] = idx
            state_gate[1] = gate
            args.action(idx, gate)

            crops.dirty.grid = true
            crops.dirty.screen = true
        end
        
        -- local set_idx_gate_wr = multipattern.wrap(args.multipattern, args.id, set_idx_gate)

        args.pattern.process = function(e) set_idx_gate(table.unpack(e)) end
        local set_idx_gate_wr = function(idx, gate)
            set_idx_gate(idx, gate)
            args.pattern:watch({ idx, gate })
        end

        local set_states = function(value)
            local gate = 0
            local idx = state_integer[1]

            for i = args.size, 1, -1 do
                local v = value[i] or 0

                if v > 0 then
                    gate = 1
                    idx = i
                    break;
                end
            end

            state_momentaries[1] = value
            set_idx_gate_wr(idx, gate)
        end

        state_momentaries[2] = set_states

        local clear = function() set_idx_gate(state_integer[1], 0) end
        local snapshot = function()
            if state_gate[1] > 0 then set_idx_gate_wr(state_integer[1], state_gate[1]) end
        end

        local handlers = {
            pre_clear = clear,
            pre_rec_stop = snapshot,
            post_rec_start = snapshot,
            post_stop = clear,
        }

        args.pattern:set_all_hooks(handlers)
    
        local _momentaries = Grid.momentaries()
        local _integer = Grid.integer()

        return function(props)
            -- setmetatable(props, default_props)

            props.size = args.size

            local momentaries_props = {}
            local integer_props = {}
            for k,v in pairs(props) do 
                momentaries_props[k] = props[k] 
                integer_props[k] = props[k] 
            end

            momentaries_props.state = state_momentaries
            integer_props.state = state_integer
        
            if crops.mode == 'input' then
                _momentaries(momentaries_props)
            elseif crops.mode == 'redraw' then
                if state_gate[1] > 0 then
                    _integer(integer_props)
                end
            end
        end
    end
end

return Pattern_time_extended
