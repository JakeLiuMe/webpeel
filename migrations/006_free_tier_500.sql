-- Migration: Increase free tier limits from 125/wk to 500/wk
-- Run this on the production database to update existing free tier users

UPDATE users 
SET weekly_limit = 500, burst_limit = 50 
WHERE tier = 'free' AND weekly_limit = 125;
