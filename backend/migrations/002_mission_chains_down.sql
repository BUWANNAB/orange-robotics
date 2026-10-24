-- Destructive rollback: run only after backing up any task-chain plans and runs.
DROP TABLE IF EXISTS rds_mission_run;
DROP TABLE IF EXISTS rds_mission_settings;
DROP TABLE IF EXISTS rds_task_plan;
