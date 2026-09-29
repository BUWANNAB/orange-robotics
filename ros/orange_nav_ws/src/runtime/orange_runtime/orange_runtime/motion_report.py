"""Export observed command/odometry speed, acceleration and jerk from a ROS 2 bag."""
import argparse
import csv
import json
import math
from pathlib import Path


def derivatives(rows):
    result=[];previous=None;last_accel=None
    for timestamp,v,w in rows:
        if not all(math.isfinite(x) for x in (timestamp,v,w)):continue
        if previous and timestamp<=previous[0]:continue
        accel=angular=jerk=None
        if previous:
            dt=timestamp-previous[0]
            # A dropout is not a measured acceleration ramp.
            if dt<=.25:
                accel=(v-previous[1])/dt;angular=(w-previous[2])/dt
                if last_accel is not None:jerk=(accel-last_accel)/dt
        result.append([timestamp,v,w,accel,angular,jerk]);previous=(timestamp,v,w);last_accel=accel
    return result


def main(args=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bag');parser.add_argument('--output',required=True)
    parser.add_argument('--storage',default='sqlite3',choices=['sqlite3','mcap'])
    options=parser.parse_args(args)
    import rosbag2_py
    from rclpy.serialization import deserialize_message
    from rosidl_runtime_py.utilities import get_message
    reader=rosbag2_py.SequentialReader()
    reader.open(rosbag2_py.StorageOptions(uri=options.bag,storage_id=options.storage),rosbag2_py.ConverterOptions('',''))
    types={t.name:get_message(t.type) for t in reader.get_all_topics_and_types() if t.name in {'/cmd_vel','/odom_topic'}}
    rows={topic:[] for topic in types}
    while reader.has_next():
        topic,raw,timestamp=reader.read_next()
        if topic not in rows:continue
        msg=deserialize_message(raw,types[topic]);twist=msg if topic=='/cmd_vel' else msg.twist.twist
        rows[topic].append((timestamp/1e9,twist.linear.x,twist.angular.z))
    output=Path(options.output);output.mkdir(parents=True,exist_ok=True)
    summary={}
    for topic,values in rows.items():
        data=derivatives(values)
        with (output/(topic.strip('/')+'.csv')).open('w',newline='') as file:
            writer=csv.writer(file);writer.writerow(['bag_time_s','v_m_s','w_rad_s','a_m_s2','angular_a_rad_s2','jerk_m_s3']);writer.writerows(data)
        summary[topic]={'samples':len(data),'max_abs_speed':max((abs(r[1]) for r in data),default=None),
            'max_abs_accel':max((abs(r[3]) for r in data if r[3] is not None),default=None),
            'max_abs_jerk':max((abs(r[5]) for r in data if r[5] is not None),default=None)}
    summary['note']='Derivative estimates use bag receipt times. Protective stops, timing jitter and odometry noise require manual interpretation; this is not an automatic acceptance verdict.'
    (output/'summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
    print(json.dumps(summary,indent=2,ensure_ascii=False))
