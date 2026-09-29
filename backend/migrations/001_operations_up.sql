-- RCS/RDS additive schema. Back up the database before applying.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS rcs_robot (
	code VARCHAR(80) NOT NULL, 
	name VARCHAR(128) NOT NULL, 
	model VARCHAR(80) NOT NULL, 
	area VARCHAR(128), 
	ip VARCHAR(45), 
	firmware VARCHAR(80), 
	hardware VARCHAR(80), 
	map_id INTEGER, 
	enabled BOOL NOT NULL, 
	deleted BOOL NOT NULL, 
	locked BOOL NOT NULL, 
	emergency BOOL NOT NULL, 
	maintenance BOOL NOT NULL, 
	upgrade_reservation INTEGER, 
	lock_reason VARCHAR(255), 
	device_key_hash VARCHAR(64) NOT NULL, 
	heartbeat DATETIME, 
	seq INTEGER NOT NULL, 
	telemetry JSON NOT NULL, 
	policy JSON, 
	revision INTEGER NOT NULL, 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (code)
);

CREATE INDEX ix_rcs_robot_created_at ON rcs_robot (created_at);

CREATE INDEX ix_rcs_robot_heartbeat ON rcs_robot (heartbeat);

CREATE INDEX ix_rcs_robot_map_id ON rcs_robot (map_id);

CREATE INDEX ix_rcs_robot_upgrade_reservation ON rcs_robot (upgrade_reservation);

CREATE TABLE IF NOT EXISTS rcs_battery_sample (
	robot_id INTEGER NOT NULL, 
	percent FLOAT NOT NULL, 
	voltage FLOAT, 
	temperature FLOAT, 
	charging BOOL NOT NULL, 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX ix_battery_robot_time ON rcs_battery_sample (robot_id, created_at);

CREATE INDEX ix_rcs_battery_sample_created_at ON rcs_battery_sample (created_at);

CREATE TABLE IF NOT EXISTS rcs_alarm (
	robot_id INTEGER, 
	code VARCHAR(80) NOT NULL, 
	level VARCHAR(20) NOT NULL, 
	title VARCHAR(255) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	note TEXT, 
	acknowledged_by VARCHAR(128), 
	acknowledged_at DATETIME, 
	closed_at DATETIME, 
	count INTEGER NOT NULL, 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX ix_alarm_robot_code_time ON rcs_alarm (robot_id, code, created_at);

CREATE INDEX ix_rcs_alarm_created_at ON rcs_alarm (created_at);

CREATE INDEX ix_rcs_alarm_robot_id ON rcs_alarm (robot_id);

CREATE INDEX ix_rcs_alarm_status ON rcs_alarm (status);

CREATE TABLE IF NOT EXISTS rcs_command (
	robot_id INTEGER NOT NULL, 
	command VARCHAR(40) NOT NULL, 
	params JSON NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	result TEXT, 
	`key` VARCHAR(128) NOT NULL, 
	expires_at DATETIME NOT NULL, 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_command_robot_key UNIQUE (robot_id, `key`)
);

CREATE INDEX ix_rcs_command_created_at ON rcs_command (created_at);

CREATE INDEX ix_rcs_command_robot_id ON rcs_command (robot_id);

CREATE INDEX ix_rcs_command_status ON rcs_command (status);

CREATE TABLE IF NOT EXISTS rds_task_run (
	name VARCHAR(128) NOT NULL, 
	legacy_task_id INTEGER, 
	robot_id INTEGER, 
	map_id INTEGER NOT NULL, 
	source VARCHAR(80) NOT NULL, 
	external_id VARCHAR(128), 
	priority INTEGER NOT NULL, 
	from_point VARCHAR(80) NOT NULL, 
	to_point VARCHAR(80) NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	started_at DATETIME, 
	finished_at DATETIME, 
	deadline DATETIME, 
	failure TEXT, 
	timeline JSON NOT NULL, 
	payload_hash VARCHAR(64), 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_task_source_external UNIQUE (source, external_id)
);

CREATE INDEX ix_rds_task_run_created_at ON rds_task_run (created_at);

CREATE INDEX ix_rds_task_run_robot_id ON rds_task_run (robot_id);

CREATE INDEX ix_rds_task_run_status ON rds_task_run (status);

CREATE TABLE IF NOT EXISTS rcs_audit_log (
	level VARCHAR(16) NOT NULL, 
	module VARCHAR(40) NOT NULL, 
	robot_id INTEGER, 
	task_id INTEGER, 
	trace_id VARCHAR(80) NOT NULL, 
	message TEXT NOT NULL, 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX ix_rcs_audit_log_created_at ON rcs_audit_log (created_at);

CREATE INDEX ix_rcs_audit_log_level ON rcs_audit_log (level);

CREATE INDEX ix_rcs_audit_log_trace_id ON rcs_audit_log (trace_id);

CREATE TABLE IF NOT EXISTS rds_map (
	name VARCHAR(128) NOT NULL, 
	revision INTEGER NOT NULL, 
	published_version INTEGER NOT NULL, 
	draft JSON NOT NULL, 
	lock_owner VARCHAR(128), 
	lock_until DATETIME, 
	deleted BOOL NOT NULL, 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (name)
);

CREATE INDEX ix_rds_map_created_at ON rds_map (created_at);

CREATE TABLE IF NOT EXISTS rds_map_version (
	map_id INTEGER NOT NULL, 
	version INTEGER NOT NULL, 
	document JSON NOT NULL, 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_map_version UNIQUE (map_id, version)
);

CREATE INDEX ix_rds_map_version_created_at ON rds_map_version (created_at);

CREATE TABLE IF NOT EXISTS rds_integration_app (
	code VARCHAR(80) NOT NULL, 
	name VARCHAR(128) NOT NULL, 
	secret TEXT NOT NULL, 
	enabled BOOL NOT NULL, 
	ips JSON NOT NULL, 
	callback_url VARCHAR(1000), 
	qps INTEGER NOT NULL, 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (code)
);

CREATE INDEX ix_rds_integration_app_created_at ON rds_integration_app (created_at);

CREATE TABLE IF NOT EXISTS rds_integration_nonce (
	`key` VARCHAR(180) NOT NULL, 
	expires_at DATETIME NOT NULL, 
	PRIMARY KEY (`key`)
);

CREATE INDEX ix_rds_integration_nonce_expires_at ON rds_integration_nonce (expires_at);

CREATE TABLE IF NOT EXISTS rds_callback (
	task_id INTEGER NOT NULL, 
	app_id INTEGER NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	attempts INTEGER NOT NULL, 
	next_at DATETIME NOT NULL, 
	result VARCHAR(500), 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (task_id)
);

CREATE INDEX ix_rds_callback_created_at ON rds_callback (created_at);

CREATE INDEX ix_rds_callback_status ON rds_callback (status);

CREATE TABLE IF NOT EXISTS rcs_firmware (
	name VARCHAR(128) NOT NULL, 
	version VARCHAR(80) NOT NULL, 
	model VARCHAR(80) NOT NULL, 
	min_hardware VARCHAR(80), 
	sha256 VARCHAR(64) NOT NULL, 
	size INTEGER NOT NULL, 
	received INTEGER NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	changelog TEXT, 
	auditor VARCHAR(128), 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_firmware_model_version UNIQUE (model, version)
);

CREATE INDEX ix_rcs_firmware_created_at ON rcs_firmware (created_at);

CREATE TABLE IF NOT EXISTS rcs_upgrade (
	name VARCHAR(128) NOT NULL, 
	package_id INTEGER NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	batch_size INTEGER NOT NULL, 
	interval_seconds INTEGER NOT NULL, 
	next_at DATETIME NOT NULL, 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX ix_rcs_upgrade_created_at ON rcs_upgrade (created_at);

CREATE INDEX ix_rcs_upgrade_status ON rcs_upgrade (status);

CREATE TABLE IF NOT EXISTS rcs_upgrade_detail (
	task_id INTEGER NOT NULL, 
	robot_id INTEGER NOT NULL, 
	version_from VARCHAR(80), 
	status VARCHAR(24) NOT NULL, 
	progress INTEGER NOT NULL, 
	error VARCHAR(500), 
	attempts INTEGER NOT NULL, 
	command_id INTEGER, 
	id INTEGER NOT NULL AUTO_INCREMENT, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	operator VARCHAR(128) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_upgrade_robot UNIQUE (task_id, robot_id)
);

CREATE INDEX ix_rcs_upgrade_detail_created_at ON rcs_upgrade_detail (created_at);

CREATE INDEX ix_rcs_upgrade_detail_robot_id ON rcs_upgrade_detail (robot_id);

CREATE INDEX ix_rcs_upgrade_detail_task_id ON rcs_upgrade_detail (task_id);
