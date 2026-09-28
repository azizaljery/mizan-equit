CREATE TABLE `aziz_monitor_records` (
  `id` text PRIMARY KEY NOT NULL,
  `symbol` text NOT NULL,
  `market` text NOT NULL,
  `issued_at` text NOT NULL,
  `available_at` text NOT NULL,
  `horizon` integer NOT NULL,
  `base_price` real NOT NULL,
  `currency` text NOT NULL,
  `status` text NOT NULL,
  `data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_aziz_monitor_symbol_issued` ON `aziz_monitor_records` (`symbol`,`issued_at`);
--> statement-breakpoint
CREATE INDEX `idx_aziz_monitor_horizon` ON `aziz_monitor_records` (`horizon`);
--> statement-breakpoint
INSERT INTO `aziz_monitor_records` (`id`,`symbol`,`market`,`issued_at`,`available_at`,`horizon`,`base_price`,`currency`,`status`,`data`) VALUES
('aziz-pilot-2222-2026-09-27-h5','2222.SR','sa','2026-09-26T23:19:00.000Z','2026-09-26T23:19:00.000Z',5,25.78,'SAR','pilot_untrained','{"kind":"aziz-pilot-monitor-v1","company":"Saudi Aramco","issuedLabel":"قبل افتتاح 27 سبتمبر 2026","source":"user-supplied Yahoo historical-price screenshots","lastMarketSession":"2026-09-24","expectedClose":25.77,"closeRange":[25.60,25.94],"intradayRange":[25.50,26.05],"direction":"محايد يميل للهبوط","support":[25.64,25.52],"resistance":[25.90,26.06],"targetSession":"2026-10-01","note":"قراءة تجريبية غير مدرّبة؛ لا توصية ولا توقع ميزان."}'),
('aziz-pilot-2222-2026-09-27-h21','2222.SR','sa','2026-09-26T23:19:00.000Z','2026-09-26T23:19:00.000Z',21,25.78,'SAR','pilot_untrained','{"kind":"aziz-pilot-monitor-v1","company":"Saudi Aramco","issuedLabel":"قبل افتتاح 27 سبتمبر 2026","source":"user-supplied Yahoo historical-price screenshots","lastMarketSession":"2026-09-24","expectedClose":25.69,"closeRange":[25.20,26.18],"direction":"محايد يميل للهبوط","targetSession":"2026-10-25","note":"قراءة تجريبية غير مدرّبة؛ لا توصية ولا توقع ميزان."}');
