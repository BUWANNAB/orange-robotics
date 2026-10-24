// File-only processor: same PCL radius filtering as pcd2pgm, no ROS motion topics.
#include <pcl/io/pcd_io.h>
#include <pcl/common/common.h>
#include <pcl/filters/radius_outlier_removal.h>
#include <pcl/kdtree/kdtree_flann.h>
#include <Eigen/Geometry>
#include <boost/property_tree/ptree.hpp>
#include <boost/property_tree/json_parser.hpp>
#include <fstream>
#include <iostream>
#include <cmath>
#include <vector>
#include <stdexcept>

struct EraseBrushStroke {
  double radius{};
  std::vector<pcl::PointXY> points;
};

int main(int argc, char **argv) {
  try {
    if (argc != 2) throw std::runtime_error("Expected one JSON job file");
    boost::property_tree::ptree job;
    boost::property_tree::read_json(argv[1], job);
    using Point = pcl::PointXYZI;
    using Cloud = pcl::PointCloud<Point>;
    Cloud::Ptr original(new Cloud), clipped(new Cloud), result(new Cloud);
    if (pcl::io::loadPCDFile<Point>(job.get<std::string>("input"), *original) < 0 || original->empty())
      throw std::runtime_error("Cannot read a nonempty PCD");
    if (original->size() > 20000000) throw std::runtime_error("More than 20 million points; split the input first");
    const double low=job.get<double>("z_min"), high=job.get<double>("z_max");
    const double resolution=job.get<double>("resolution"), radius=job.get<double>("radius");
    const int neighbors=job.get<int>("neighbors");
    const auto brush_data=job.get_child_optional("erase_brush");
    std::vector<EraseBrushStroke> brush_strokes;
    size_t brush_point_count=0;
    if (brush_data) for (const auto &entry : *brush_data) {
      EraseBrushStroke stroke;
      stroke.radius=entry.second.get<double>("radius");
      const auto path=entry.second.get_child_optional("points");
      if (!path || path->empty() || !std::isfinite(stroke.radius) || stroke.radius<=0 || stroke.radius>5)
        throw std::runtime_error("Invalid point-cloud eraser stroke");
      for (const auto &point_entry : *path) {
        pcl::PointXY point;
        point.x=point_entry.second.get<float>("x");
        point.y=point_entry.second.get<float>("y");
        if (!std::isfinite(point.x)||!std::isfinite(point.y)||std::abs(point.x)>1000000||std::abs(point.y)>1000000)
          throw std::runtime_error("Point-cloud eraser coordinates must be finite and within +/- 1000000 m");
        stroke.points.push_back(point);
        if (++brush_point_count>20000) throw std::runtime_error("Too many point-cloud eraser path points");
      }
      brush_strokes.push_back(std::move(stroke));
      if (brush_strokes.size()>100) throw std::runtime_error("Too many point-cloud eraser strokes");
    }
    const auto coordinate_origin=job.get_child_optional("origin");
    double origin_x=0.0,origin_y=0.0,origin_yaw=0.0;
    if (coordinate_origin) {
      origin_x=coordinate_origin->get<double>("x");
      origin_y=coordinate_origin->get<double>("y");
      origin_yaw=coordinate_origin->get<double>("yaw");
      if (!std::isfinite(origin_x)||!std::isfinite(origin_y)||!std::isfinite(origin_yaw))
        throw std::runtime_error("Coordinate origin must contain finite x, y and yaw values");
    }
    if (!std::isfinite(low) || !std::isfinite(high) || low>=high ||
        !std::isfinite(resolution) || resolution<0.01 || resolution>1 ||
        !std::isfinite(radius) || radius<=0 || radius>5 || neighbors<1 || neighbors>128)
      throw std::runtime_error("Invalid filter parameters");
    const auto boxes=job.get_child_optional("erase");
    const auto crop=job.get_child_optional("crop");
    auto in_box=[](const Point &p, const boost::property_tree::ptree &b) {
      return p.x>=b.get<double>("x_min") && p.x<=b.get<double>("x_max") &&
             p.y>=b.get<double>("y_min") && p.y<=b.get<double>("y_max");
    };
    for (const auto &p : original->points) {
      if (!std::isfinite(p.x)||!std::isfinite(p.y)||!std::isfinite(p.z)||p.z<low||p.z>high) continue;
      if (crop && !crop->empty() && !in_box(p,*crop)) continue;
      bool erased=false;
      if (boxes) for (const auto &entry : *boxes) if (in_box(p,entry.second)) {erased=true;break;}
      if (!erased) clipped->push_back(p);
    }
    if (clipped->empty()) throw std::runtime_error("Crop/erase removed every point");
    Cloud::Ptr manually_filtered(new Cloud());
    size_t manually_erased=0;
    if (!brush_strokes.empty()) {
      using XYCloud=pcl::PointCloud<pcl::PointXY>;
      XYCloud::Ptr xy(new XYCloud());
      xy->reserve(clipped->size());
      for (const auto &p : clipped->points) {
        pcl::PointXY point;point.x=p.x;point.y=p.y;xy->push_back(point);
      }
      pcl::KdTreeFLANN<pcl::PointXY> tree;tree.setInputCloud(xy);
      std::vector<unsigned char> erased(clipped->size(),0);
      std::vector<int> indices;std::vector<float> squared_distances;
      size_t query_count=0;
      const size_t max_query_count=100000;
      for (const auto &stroke : brush_strokes) {
        const double spacing=std::max(0.02,std::min(0.1,stroke.radius*0.25));
        auto erase_circle=[&](double x,double y,double support_radius) {
          if (++query_count>max_query_count)
            throw std::runtime_error("橡皮擦路径过长，请分段擦除或调大橡皮尺寸");
          pcl::PointXY query;query.x=static_cast<float>(x);query.y=static_cast<float>(y);
          indices.clear();squared_distances.clear();
          if (tree.radiusSearch(query,support_radius,indices,squared_distances)>0)
            for (const int index : indices) if (index>=0) erased[static_cast<size_t>(index)]=1;
        };
        if (stroke.points.size()==1) {
          erase_circle(stroke.points.front().x,stroke.points.front().y,stroke.radius);
          continue;
        }
        for (size_t i=1;i<stroke.points.size();++i) {
          const auto &a=stroke.points[i-1];const auto &b=stroke.points[i];
          const double dx=static_cast<double>(b.x)-a.x,dy=static_cast<double>(b.y)-a.y;
          const double length=std::hypot(dx,dy);
          const size_t steps=std::max<size_t>(1,static_cast<size_t>(std::ceil(length/spacing)));
          if (steps>max_query_count-query_count)
            throw std::runtime_error("橡皮擦路径过长，请分段擦除或调大橡皮尺寸");
          const double support_radius=std::sqrt(stroke.radius*stroke.radius+spacing*spacing*0.25);
          for (size_t step=0;step<=steps;++step) {
            if (i>1&&step==0) continue;
            const double t=static_cast<double>(step)/steps;
            erase_circle(a.x+dx*t,a.y+dy*t,support_radius);
          }
        }
      }
      manually_filtered->reserve(clipped->size());
      for (size_t i=0;i<clipped->size();++i) {
        if (erased[i]) ++manually_erased;
        else manually_filtered->push_back(clipped->points[i]);
      }
    } else *manually_filtered=*clipped;
    if (manually_filtered->empty()) throw std::runtime_error("橡皮擦删除了全部点，请撤销部分笔画或缩小橡皮尺寸");
    if (job.get<bool>("denoise")) {
      pcl::RadiusOutlierRemoval<Point> filter;
      filter.setInputCloud(manually_filtered);filter.setRadiusSearch(radius);filter.setMinNeighborsInRadius(neighbors);
      filter.filter(*result);
    } else *result=*manually_filtered;
    if (result->empty()) throw std::runtime_error("Denoising removed every point; adjust radius/neighbors");
    if (coordinate_origin) {
      // Re-express a copy of the filtered cloud in the selected origin and heading.
      // The chosen source point becomes (0, 0); its selected direction becomes +X.
      const double cosine=std::cos(origin_yaw),sine=std::sin(origin_yaw);
      for (auto &point : result->points) {
        const double dx=point.x-origin_x,dy=point.y-origin_y;
        point.x=static_cast<float>(cosine*dx+sine*dy);
        point.y=static_cast<float>(-sine*dx+cosine*dy);
      }
      const Eigen::Vector4f sensor=result->sensor_origin_;
      const double sensor_dx=sensor.x()-origin_x,sensor_dy=sensor.y()-origin_y;
      result->sensor_origin_=Eigen::Vector4f(
        static_cast<float>(cosine*sensor_dx+sine*sensor_dy),
        static_cast<float>(-sine*sensor_dx+cosine*sensor_dy),sensor.z(),1.0f);
      const Eigen::Quaternionf frame_rotation(Eigen::AngleAxisf(-origin_yaw,Eigen::Vector3f::UnitZ()));
      result->sensor_orientation_=frame_rotation*result->sensor_orientation_;
    }
    Point min,max;pcl::getMinMax3D(*result,min,max);
    // Without a selected origin, keep the original frame; otherwise rasterize transformed points.
    const double ox=std::floor(min.x/resolution)*resolution-resolution;
    const double oy=std::floor(min.y/resolution)*resolution-resolution;
    const double width_d=std::ceil((max.x-ox)/resolution)+2, height_d=std::ceil((max.y-oy)/resolution)+2;
    if (width_d<=0||height_d<=0||width_d*height_d>40000000)
      throw std::runtime_error("Grid exceeds 40 million pixels; increase resolution or crop input");
    const size_t width=static_cast<size_t>(width_d),height=static_cast<size_t>(height_d);
    // Projection does not observe free space: untouched cells remain unknown (205).
    std::vector<unsigned char> pixels(width*height,205);
    for (const auto &p : result->points) {
      const size_t x=static_cast<size_t>(std::floor((p.x-ox)/resolution));
      const size_t y=static_cast<size_t>(std::floor((p.y-oy)/resolution));
      if(x<width&&y<height)pixels[(height-1-y)*width+x]=0;
    }
    const std::string root=job.get<std::string>("directory")+"/";
    if (pcl::io::savePCDFileBinary(root+"GlobalMap.pcd",*result)<0) throw std::runtime_error("PCD write failed");
    std::ofstream pgm(root+"map.pgm",std::ios::binary);
    pgm << "P5\n" << width << " " << height << "\n255\n";
    pgm.write(reinterpret_cast<const char*>(pixels.data()),pixels.size());pgm.close();
    if (!pgm) throw std::runtime_error("PGM write failed");
    std::ofstream yaml(root+"map.yaml");yaml.precision(12);
    yaml << "image: map.pgm\nresolution: " << resolution << "\norigin: [" << ox << ", " << oy
         << ", 0.0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.196\n";
    yaml.close();if(!yaml)throw std::runtime_error("YAML write failed");
    boost::property_tree::ptree stats;
    stats.put("input_points",original->size());stats.put("after_crop",clipped->size());
    stats.put("after_manual_erase",manually_filtered->size());stats.put("manual_erased_points",manually_erased);
    stats.put("denoise_removed_points",manually_filtered->size()-result->size());
    stats.put("output_points",result->size());stats.put("removed_points",original->size()-result->size());
    stats.put("width",width);stats.put("height",height);stats.put("frame","map");
    stats.put("coordinate_transform",static_cast<bool>(coordinate_origin));
    if (coordinate_origin) {
      stats.put("source_origin_x",origin_x);stats.put("source_origin_y",origin_y);
      stats.put("source_origin_yaw_rad",origin_yaw);
    }
    boost::property_tree::write_json(root+"result.json",stats);
    return 0;
  } catch(const std::exception &error) {std::cerr << error.what() << std::endl;return 1;}
}
