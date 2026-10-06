import copy
import unittest

from app.services.obstacle_protection import (
    DEFAULT_OBSTACLE_CONFIG,
    nav2_humble_parameters,
    validate_obstacle_config,
)


class ObstacleProtectionTests(unittest.TestCase):
    def test_defaults_are_valid_and_disabled(self):
        config = validate_obstacle_config(copy.deepcopy(DEFAULT_OBSTACLE_CONFIG))
        self.assertFalse(config["enabled"])
        self.assertFalse(any(region["enabled"] for region in config["regions"]))

    def test_enabled_protection_requires_a_stop_region(self):
        config = copy.deepcopy(DEFAULT_OBSTACLE_CONFIG)
        config["enabled"] = True
        config["regions"][0]["enabled"] = True
        config["regions"][0]["action"] = "slowdown"
        with self.assertRaisesRegex(ValueError, "至少保留一个停车区"):
            validate_obstacle_config(config)

    def test_humble_polygon_points_are_flat_numeric_parameter_arrays(self):
        config = copy.deepcopy(DEFAULT_OBSTACLE_CONFIG)
        config["enabled"] = True
        config["regions"][1]["enabled"] = True
        params = nav2_humble_parameters(config)
        polygon = params["front_stop"]
        self.assertIsInstance(polygon["points"], list)
        self.assertEqual(len(polygon["points"]), 8)
        self.assertTrue(all(isinstance(value, float) for value in polygon["points"]))
        self.assertNotIn("min_range", params["pointcloud"])

    def test_zone_bounds_must_be_ordered_and_within_range(self):
        config = copy.deepcopy(DEFAULT_OBSTACLE_CONFIG)
        config["regions"][1]["x_min"] = 0.8
        with self.assertRaisesRegex(ValueError, "最小值必须小于最大值"):
            validate_obstacle_config(config)


if __name__ == "__main__":
    unittest.main()
