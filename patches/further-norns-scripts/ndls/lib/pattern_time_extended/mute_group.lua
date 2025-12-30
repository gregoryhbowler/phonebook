-- mute group for multiple pattern_time instances. allows only one pattern to be active at a time

local mute_group = {}
mute_group.__index = mute_group

local hook_defaults = {
    pre_clear = function() end,
    post_stop = function() end,
    pre_resume = function() end,
    pre_rec_stop = function() end,
    post_rec_start = function() end,
    pre_rec_start = function() end,
}
hook_defaults.__index = hook_defaults

local silent = true

-- constructor. overwrites hooks & process for all patterns. these values should be set via this class and shared between all patterns in the group.
function mute_group.new(patterns, hooks)
    local i = {}
    setmetatable(i, mute_group)

    i.patterns = patterns or {}

    i.hooks = setmetatable(hooks or {}, hook_defaults)

    i.process = function(_) print("event") end

    i.handlers = {
        pre_clear = function() 
            i.hooks.pre_clear()
        end,
        post_stop = function() 
            i.hooks.post_stop()
        end,
        pre_resume = function() 
            i:stop()
            i.hooks.pre_resume()
        end,
        pre_rec_stop = function() 
            i.hooks.pre_rec_stop()
        end,
        pre_rec_start = function() 
            i:stop()
            i.hooks.pre_rec_start()
        end,
        post_rec_start = function() 
            i.hooks.post_rec_start()
        end,
    }

    for _,pat in ipairs(i.patterns) do
        pat.process = function(...) i.process(...) end

        pat:set_all_hooks(i.handlers)
    end

    return i
end
    
function mute_group:set_hook(name, fn)
    self.hooks[name] = fn
end

function mute_group:set_all_hooks(hooks)
    self.hooks = setmetatable(hooks or {}, hook_defaults)
end

function mute_group:watch(e)
    for _,pat in ipairs(self.patterns) do
        pat:watch(e)
    end
end

function mute_group:stop()
    for _,pat in ipairs(self.patterns) do
        pat:rec_stop()
        pat:set_overdub(0)
        pat:stop()
    end
end

-- note: returns nil if no pattern is playing
function mute_group:get_playing_pattern()
    for _,pat in ipairs(self.patterns) do
        if pat.play == 1 then
            return pat
        end
    end
end

return mute_group
