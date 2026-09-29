import os
import shutil
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

from app.config import settings

logger = logging.getLogger("orange_agv.map_service")

SETTING_DIR = "setting"
PGM_FILE_NAME = "map.pgm"
YAML_FILE_NAME = "map.yaml"

class MapService:
    """PGM 与 PCD 地图资产管理核心服务"""

    @classmethod
    def get_maps_root(cls) -> Path:
        """获取地图存放物理根目录"""
        path = settings.MAPS_DIR
        path.mkdir(parents=True, exist_ok=True)
        return path

    @classmethod
    def get_pcd_root(cls) -> Path:
        """获取点云 PCD 存放物理根目录"""
        path = settings.PCD_DIR
        path.mkdir(parents=True, exist_ok=True)
        return path

    @classmethod
    def get_map_tree(cls) -> List[Dict[str, Any]]:
        """递归扫描所有地图目录，构建树形结构节点 (对标 Java PGMController.getMapList)"""
        root = cls.get_maps_root()
        return cls._find_maps_recursively(root, root)

    @classmethod
    def _find_maps_recursively(cls, current_dir: Path, root_dir: Path) -> List[Dict[str, Any]]:
        nodes = []
        if not current_dir.exists() or not current_dir.is_dir():
            return nodes

        try:
            for item in sorted(current_dir.iterdir()):
                if not item.is_dir() or item.name == SETTING_DIR or item.name.startswith("."):
                    continue

                pgm_file = item / SETTING_DIR / PGM_FILE_NAME
                yaml_file = item / SETTING_DIR / YAML_FILE_NAME

                # 当 setting 目录下同时存在 map.pgm 和 map.yaml 时即为合规地图
                if pgm_file.exists() and yaml_file.exists():
                    try:
                        rel_path = str(item.relative_to(root_dir)).replace("\\", "/")
                    except ValueError:
                        rel_path = item.name

                    node = {
                        "name": item.name,
                        "path": rel_path,
                        "children": cls._find_maps_recursively(item, root_dir)
                    }
                    nodes.append(node)
                else:
                    # 递归探索可能存放更深级地图的子目录
                    sub_children = cls._find_maps_recursively(item, root_dir)
                    if sub_children:
                        try:
                            rel_path = str(item.relative_to(root_dir)).replace("\\", "/")
                        except ValueError:
                            rel_path = item.name
                        nodes.append({
                            "name": item.name,
                            "path": rel_path,
                            "children": sub_children
                        })
        except Exception as e:
            logger.error("扫描地图目录失败: %s - %s", current_dir, str(e))

        return nodes

    @classmethod
    def find_map_dir(cls, map_name: str) -> Optional[Path]:
        """根据地图名称递归查找物理目录"""
        # 安全防御：杜绝路径遍历
        clean_name = os.path.basename(map_name.strip("/\\"))
        if not clean_name or ".." in map_name:
            return None

        root = cls.get_maps_root()
        return cls._find_dir_by_name(root, clean_name)

    @classmethod
    def _find_dir_by_name(cls, current_dir: Path, target_name: str) -> Optional[Path]:
        if not current_dir.exists() or not current_dir.is_dir():
            return None

        if current_dir.name == target_name:
            if (current_dir / SETTING_DIR / PGM_FILE_NAME).exists() and (current_dir / SETTING_DIR / YAML_FILE_NAME).exists():
                return current_dir

        try:
            for item in current_dir.iterdir():
                if item.is_dir() and item.name != SETTING_DIR and not item.name.startswith("."):
                    found = cls._find_dir_by_name(item, target_name)
                    if found:
                        return found
        except Exception:
            pass

        return None

    @classmethod
    def get_map_file_path(cls, map_name: str, file_type: str) -> Optional[Path]:
        """获取地图的具体文件路径 (pgm 或 yaml)"""
        map_dir = cls.find_map_dir(map_name)
        if not map_dir:
            return None

        filename = PGM_FILE_NAME if file_type.lower() == "pgm" else YAML_FILE_NAME
        target_file = map_dir / SETTING_DIR / filename
        if target_file.exists():
            return target_file
        return None

    @classmethod
    def save_map(cls, rel_path: str, pgm_bytes: bytes, yaml_bytes: bytes) -> bool:
        """保存上传的地图文件 (PGM 与 YAML)"""
        # 清理路径，防止越权写入
        clean_rel = rel_path.strip("/\\").replace("..", "").replace("\\", "/")
        root = cls.get_maps_root()
        target_dir = root / clean_rel / SETTING_DIR
        target_dir.mkdir(parents=True, exist_ok=True)

        try:
            pgm_target = target_dir / PGM_FILE_NAME
            yaml_target = target_dir / YAML_FILE_NAME

            with open(pgm_target, "wb") as f:
                f.write(pgm_bytes)
            with open(yaml_target, "wb") as f:
                f.write(yaml_bytes)

            logger.info("成功保存地图至: %s", target_dir)
            return True
        except Exception as e:
            logger.error("写入地图文件失败: %s", str(e))
            return False

    @classmethod
    def save_as(cls, source_map_name: str, new_map_name: str) -> bool:
        """地图另存为"""
        src_dir = cls.find_map_dir(source_map_name)
        if not src_dir:
            return False

        clean_new = os.path.basename(new_map_name.strip("/\\"))
        if not clean_new:
            return False

        dst_dir = src_dir.parent / clean_new
        if dst_dir.exists():
            return False

        try:
            shutil.copytree(src_dir, dst_dir)
            logger.info("地图另存为成功: %s -> %s", src_dir, dst_dir)
            return True
        except Exception as e:
            logger.error("地图另存为失败: %s", str(e))
            return False

    @classmethod
    def delete_map(cls, map_name: str) -> bool:
        """删除指定地图"""
        map_dir = cls.find_map_dir(map_name)
        if not map_dir:
            return False

        try:
            shutil.rmtree(map_dir)
            logger.info("成功删除地图: %s", map_dir)
            return True
        except Exception as e:
            logger.error("删除地图失败: %s", str(e))
            return False

    @classmethod
    def get_pcd_list(cls) -> List[Dict[str, Any]]:
        """获取所有 PCD 点云列表"""
        root = cls.get_pcd_root()
        items = []
        if not root.exists():
            return items

        try:
            for item in sorted(root.iterdir()):
                if item.name.startswith("."):
                    continue
                if item.is_file() and item.name.endswith(".pcd"):
                    items.append({"name": item.name, "path": item.name, "size": item.stat().st_size})
                elif item.is_dir():
                    # 检查子目录里的 pcd
                    for pcd in item.glob("*.pcd"):
                        items.append({
                            "name": f"{item.name}/{pcd.name}",
                            "path": f"{item.name}/{pcd.name}",
                            "size": pcd.stat().st_size
                        })
        except Exception as e:
            logger.error("扫描 PCD 目录失败: %s", str(e))

        return items
