--- timed pattern event recorder/player
-- additional features added by @andrew
-- @module lib.pattern

local pattern = {}
pattern.__index = pattern

function pattern.new_data(data)
  data = data or {}
  data.event = {}
  data.time = {}
  data.count = 0

  return data
end

local hook_defaults = {
    pre_clear = function() end,
    post_stop = function() end,
    pre_resume = function() end,
    pre_rec_stop = function() end,
    pre_rec_start = function() end,
    post_rec_start = function() end,
}
hook_defaults.__index = hook_defaults

--- constructor
function pattern.new(data, hooks)
  local i = {}
  setmetatable(i, pattern)
  i.rec = 0
  i.play = 0
  i.overdub = 0
  i.prev_time = 0
  i.step = 0
  i.time_factor = 1
  i.reverse = false
  
  i.data = pattern.new_data(data)
  i.hooks = setmetatable(hooks or {}, hook_defaults)

  i.metro = metro.init(function() i:next_event() end,1,1)

  i.process = function(_) print("event") end

  return i
end

function pattern:set_hook(name, fn)
    self.hooks[name] = fn
end

function pattern:set_all_hooks(hooks)
    self.hooks = setmetatable(hooks or {}, hook_defaults)
end

function pattern:assign_data(data)
    self:rec_stop()
    self:stop()
    self.data = data
    self:start()
end

--- clear this pattern
function pattern:clear(silent)
  if not silent then self.hooks.pre_clear() end

  self.metro:stop()
  self.rec = 0
  self.play = 0
  self.overdub = 0
  self.prev_time = 0
  self.data.event = {}
  self.data.time = {}
  self.data.count = 0
  self.step = 0
  self.time_factor = 1
  self.reverse = false
end

--- adjust the time factor of this pattern.
-- @tparam number f time factor
function pattern:set_time_factor(f)
  self.time_factor = f or 1
end
--- adjust the direction of this pattern.
-- @tparam boolean reverse
function pattern:set_reverse(reverse)
  self.reverse = reverse
end

--- start recording
function pattern:rec_start(silent)
  if not silent then self.hooks.pre_rec_start() end

  print("pattern rec start")
  self.rec = 1

  if not silent then self.hooks.post_rec_start() end
end

--- stop recording
function pattern:rec_stop(silent)
  if self.rec == 1 then
    if not silent then self.hooks.pre_rec_stop() end

    self.rec = 0
    if self.data.count ~= 0 then
      --print("count "..self.data.count)
      local t = self.prev_time
      self.prev_time = util.time()
      self.data.time[self.data.count] = self.prev_time - t
      --tab.print(self.data.time)
    else
      print("pattern_time: no events recorded")
    end 
  else print("pattern_time: not recording")
  end
end

--- watch
function pattern:watch(e)
  if self.rec == 1 then
    self:rec_event(e)
  elseif self.overdub == 1 then
    self:overdub_event(e)
  end
end

--- record event
function pattern:rec_event(e)
  local c = self.data.count + 1
  if c == 1 then
    self.prev_time = util.time()
  else
    local t = self.prev_time
    self.prev_time = util.time()
    self.data.time[c-1] = self.prev_time - t
  end
  self.data.count = c
  self.data.event[c] = e
end

-- TODO: fix behavior for reverse playing pattern
-- add overdub event
function pattern:overdub_event(e)
  local c = self.step + 1
  local t = self.prev_time
  self.prev_time = util.time()
  local a = self.data.time[c-1]
  self.data.time[c-1] = self.prev_time - t
  table.insert(self.data.time, c, a - self.data.time[c-1])
  table.insert(self.data.event, c, e)
  self.step = self.step + 1
  self.data.count = self.data.count + 1
end

--- start this pattern
function pattern:start()
  if self.data.count > 0 then
    --print("start pattern ")
    self.prev_time = util.time()
    self.process(self.data.event[1])
    self.play = 1
    self.step = 1
    self.metro.time = self.data.time[1] * self.time_factor
    self.metro:start()
  end
end

--- resume this pattern in the last position after stopping
function pattern:resume(silent)
    if self.data.count > 0 then
        if not silent then self.hooks.pre_resume() end

        self.prev_time = util.time()
        self.process(self.data.event[self.step])
        self.play = 1
        self.metro.time = self.data.time[self.step] * self.time_factor
        self.metro:start()
    end
end

--- process next event
function pattern:next_event()
  self.prev_time = util.time()

  self.step = util.wrap(self.step + (self.reverse and -1 or 1), 1, self.data.count)

  self.process(self.data.event[self.step])
  self.metro.time = self.data.time[self.step] * self.time_factor

  self.metro:start()
end

--- stop this pattern
function pattern:stop(silent)
  if self.play == 1 then
    self.play = 0
    self.overdub = 0
    self.metro:stop()

    if not silent then self.hooks.post_stop() end
  else print("pattern_time: not playing") end
end

--- set overdub
function pattern:set_overdub(s, silent)
  if s==1 and self.play == 1 and self.rec == 0 then
    if not silent then self.hooks.pre_rec_start() end
    self.overdub = 1
    if not silent then self.hooks.post_rec_start() end
  else
    if not silent then self.hooks.pre_rec_stop() end
    self.overdub = 0
  end
end

--- export pattern data as a table, can be written to disk w/ tab.save
--- note: this data contains table references, not copies
function pattern:export()
    local pat = self
    local d = {}
    d.data = pat.data
    d.time_factor = pat.time_factor
    d.step = pat.step
    d.play = pat.play
    
    return d
end

--- import pattern data exported from pattern.export
function pattern:import(d, play_on_import)
    if d then
        for k,v in pairs(d) do
            self[k] = v
        end

        if self.play > 0 then
            if play_on_import then 
                self:start()
            else
                self.play = 0
            end
        end
    end
end

return pattern
