-- DESTRUCTIVE: run only after backing up RCS/RDS data; legacy tables are not touched.
DROP TABLE IF EXISTS rcs_upgrade_detail;
DROP TABLE IF EXISTS rcs_upgrade;
DROP TABLE IF EXISTS rcs_firmware;
DROP TABLE IF EXISTS rds_callback;
DROP TABLE IF EXISTS rds_integration_nonce;
DROP TABLE IF EXISTS rds_integration_app;
DROP TABLE IF EXISTS rds_map_version;
DROP TABLE IF EXISTS rds_map;
DROP TABLE IF EXISTS rcs_audit_log;
DROP TABLE IF EXISTS rds_task_run;
DROP TABLE IF EXISTS rcs_command;
DROP TABLE IF EXISTS rcs_alarm;
DROP TABLE IF EXISTS rcs_battery_sample;
DROP TABLE IF EXISTS rcs_robot;
