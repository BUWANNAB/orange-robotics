-- Additive schema for reusable station chains and durable manual/auto/scheduled runs.
-- Applies only to an existing MySQL installation that already ran 001_operations_up.sql.
CREATE TABLE IF NOT EXISTS rds_task_plan (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  operator VARCHAR(128) NOT NULL,
  name VARCHAR(128) NOT NULL,
  map_id INT NOT NULL,
  start_point VARCHAR(80) NOT NULL,
  steps JSON NOT NULL,
  repeat_count INT NOT NULL DEFAULT 1,
  priority INT NOT NULL DEFAULT 5,
  robot_id INT NULL,
  KEY ix_rds_task_plan_created_at (created_at),
  KEY ix_rds_task_plan_map_id (map_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rds_mission_run (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  operator VARCHAR(128) NOT NULL,
  plan_id INT NOT NULL,
  name VARCHAR(128) NOT NULL,
  map_id INT NOT NULL,
  map_version INT NOT NULL,
  start_point VARCHAR(80) NOT NULL,
  steps JSON NOT NULL,
  repeat_count INT NOT NULL,
  priority INT NOT NULL DEFAULT 5,
  robot_id INT NULL,
  task_mode VARCHAR(16) NOT NULL,
  scheduled_at DATETIME NULL,
  cycles_completed INT NOT NULL DEFAULT 0,
  step_index INT NOT NULL DEFAULT 0,
  active_task_id INT NULL,
  next_at DATETIME NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'queued',
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  failure TEXT NOT NULL,
  timeline JSON NOT NULL,
  KEY ix_rds_mission_run_created_at (created_at),
  KEY ix_rds_mission_run_plan_id (plan_id),
  KEY ix_rds_mission_run_map_id (map_id),
  KEY ix_rds_mission_run_robot_id (robot_id),
  KEY ix_rds_mission_run_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rds_mission_settings (
  id INT NOT NULL PRIMARY KEY,
  task_mode VARCHAR(16) NOT NULL DEFAULT 'manual',
  operator VARCHAR(128) NOT NULL DEFAULT 'system',
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
