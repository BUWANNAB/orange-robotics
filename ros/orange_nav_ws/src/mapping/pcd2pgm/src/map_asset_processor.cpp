// File-only processor: same PCL radius filtering as pcd2pgm, no ROS motion topics.
#include <pcl/io/pcd_io.h>
#include <pcl/common/common.h>
#include <pcl/filters/radius_outlier_removal.h>
#include <boost/property_tree/ptree.hpp>
#include <boost/property_tree/json_parser.hpp>
#include <fstream>
#include <iostream>
#include <cmath>
#include <vector>
#include <stdexcept>

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
    if (job.get<bool>("denoise")) {
      pcl::RadiusOutlierRemoval<Point> filter;
      filter.setInputCloud(clipped);filter.setRadiusSearch(radius);filter.setMinNeighborsInRadius(neighbors);
      filter.filter(*result);
    } else *result=*clipped;
    if (result->empty()) throw std::runtime_error("Denoising removed every point; adjust radius/neighbors");
    Point min,max;pcl::getMinMax3D(*result,min,max);
    // Keep the original map coordinate frame. Cropping never recenters or rotates points.
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
    stats.put("output_points",result->size());stats.put("removed_points",original->size()-result->size());
    stats.put("width",width);stats.put("height",height);stats.put("frame","map");
    boost::property_tree::write_json(root+"result.json",stats);
    return 0;
  } catch(const std::exception &error) {std::cerr << error.what() << std::endl;return 1;}
}
