from setuptools import setup
from glob import glob
setup(name='orange_runtime',version='0.1.0',packages=['orange_runtime'],
      data_files=[('share/ament_index/resource_index/packages',['resource/orange_runtime']),
                  ('share/orange_runtime',['package.xml']),('share/orange_runtime/launch',glob('launch/*.launch.py')),
                  ('share/orange_runtime/config',glob('config/*.yaml'))],
      install_requires=['setuptools'],zip_safe=True,
      entry_points={'console_scripts':['livox_cloud_converter = orange_runtime.converter:main',
                                      'global_relocalization = orange_runtime.relocalization_node:main',
                                      'motion_report = orange_runtime.motion_report:main']})
