/**
 * @fileOverview ROSLIB Node exclusive extensions 
 */
var assign = require('object-assign');

module.exports = assign(require('./RosLib.js'), {
  Ros: require('./node/RosTCP.js'),
  Topic: require('./node/TopicStream.js')
});