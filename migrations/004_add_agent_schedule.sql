-- Agent schedule settings for working hours and holidays
-- work_schedule: 7x24 boolean matrix (7 days, 24 hours each)
-- holidays: array of dates in DD.MM.YYYY format
-- offline_message: message to show during non-working hours

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS work_schedule JSONB,
ADD COLUMN IF NOT EXISTS holidays TEXT[],
ADD COLUMN IF NOT EXISTS offline_message TEXT;

-- Comment for clarity
COMMENT ON COLUMN agents.work_schedule IS 'Weekly schedule: 7 arrays (Mon=0..Sun=6) x 24 booleans (hours 0-23)';
COMMENT ON COLUMN agents.holidays IS 'Holiday dates in DD.MM.YYYY format when bot is not working';
COMMENT ON COLUMN agents.offline_message IS 'Message to show during non-working hours';
