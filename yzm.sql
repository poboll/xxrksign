/*
 Navicat Premium Data Transfer

 Source Server         : 一叽咕
 Source Server Type    : MySQL
 Source Server Version : 80033 (8.0.33)
 Source Host           : tpe0.clusters.zeabur.com:30872
 Source Schema         : xxrk

 Target Server Type    : MySQL
 Target Server Version : 80033 (8.0.33)
 File Encoding         : 65001

 Date: 30/11/2023 14:22:16
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for yzm
-- ----------------------------
DROP TABLE IF EXISTS `yzm`;
CREATE TABLE `yzm` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `Code` varchar(255) NOT NULL,
  `Date` date NOT NULL,
  `IsUsed` tinyint(1) DEFAULT (false),
  `ExpirationTime` timestamp NOT NULL,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------
-- Records of yzm
-- ----------------------------
BEGIN;
INSERT INTO `yzm` (`ID`, `Code`, `Date`, `IsUsed`, `ExpirationTime`) VALUES (1, 'xxrk', '2023-11-29', 0, '2030-12-12 12:00:00');
INSERT INTO `yzm` (`ID`, `Code`, `Date`, `IsUsed`, `ExpirationTime`) VALUES (2, 'xxxx', '2023-11-28', 1, '2023-11-28 13:58:20');
INSERT INTO `yzm` (`ID`, `Code`, `Date`, `IsUsed`, `ExpirationTime`) VALUES (3, 'wwww', '2023-11-30', 0, '2023-11-30 14:16:06');
COMMIT;

SET FOREIGN_KEY_CHECKS = 1;
