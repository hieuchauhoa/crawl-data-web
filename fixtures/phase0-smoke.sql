-- Crawl Data Web Phase 0 smoke fixture.
-- This is intentionally tiny; use the real project SQL for final acceptance.
SET NAMES utf8mb4;

DROP TABLE IF EXISTS `bmws_seo`;
DROP TABLE IF EXISTS `bmws_gallery`;
DROP TABLE IF EXISTS `bmws_news`;
DROP TABLE IF EXISTS `bmws_product`;
DROP TABLE IF EXISTS `bmws_product_cat`;

CREATE TABLE `bmws_product_cat` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `namevi` varchar(255) NOT NULL DEFAULT '',
  `id_parent` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `bmws_product` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `namevi` varchar(255) NOT NULL DEFAULT '',
  `slugvi` varchar(255) NOT NULL DEFAULT '',
  `photo` varchar(255) DEFAULT NULL,
  `contentvi` longtext DEFAULT NULL,
  `gia` int unsigned NOT NULL DEFAULT 0,
  `ngaydang` date DEFAULT NULL,
  `id_cat` int unsigned NOT NULL DEFAULT 0,
  `status` varchar(50) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `bmws_gallery` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `id_parent` int unsigned NOT NULL DEFAULT 0,
  `photo` varchar(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `bmws_news` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `namevi` varchar(255) NOT NULL DEFAULT '',
  `slugvi` varchar(255) NOT NULL DEFAULT '',
  `contentvi` longtext DEFAULT NULL,
  `type` varchar(50) NOT NULL DEFAULT 'tin-tuc',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `bmws_seo` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `id_parent` int unsigned NOT NULL DEFAULT 0,
  `com` varchar(50) NOT NULL DEFAULT '',
  `act` varchar(50) NOT NULL DEFAULT '',
  `type` varchar(50) NOT NULL DEFAULT '',
  `titlevi` varchar(255) DEFAULT NULL,
  `keywordsvi` text DEFAULT NULL,
  `descriptionvi` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_parent` (`id_parent`,`com`,`act`,`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `bmws_product` (`namevi`,`slugvi`,`status`) VALUES
('Sản phẩm mẫu','san-pham-mau','hienthi');

INSERT INTO `bmws_news` (`namevi`,`slugvi`,`type`) VALUES
('Tin tức mẫu','tin-tuc-mau','tin-tuc');
