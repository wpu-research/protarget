# Kampanya / booking — 11 Kasım 2026

Story: `story/campaign-booking` (spec:
`_bmad-output/implementation-artifacts/tech-spec-campaign-booking.md`).
**Yerel değişikliktir; Railway'e yayımlanmadı.** Canlıda kreatif depolaması
(bucket) yoktur; yayın öncesinde depolama kararı ve onay gerekir.

Bu modül operatörün kampanyayı panelde hazırlayıp mevcut CMS'ye **elle**
yüklediği MVP modelini destekler. Panelde “Yayında / Durduruldu” kaydı ve CMS
işlem kayıtları **operatör beyanıdır**; fiziksel ekranın oynattığının veya
durduğunun kanıtı (PoP) değildir. Teslimat/impression girişi, pacing, Deal ve
ajans/marka portal görünürlüğü sonraki story'lerdedir.

## Akış

1. **Temel:** ad, reklamveren (aktif ADVERTISER kurum), opsiyonel ajans
   (aktif AGENCY kurum), iç sahip (aktif admin), başlangıç/bitiş (UTC saklanır,
   kampanya saat diliminde gösterilir), saat dilimi, not. Kod `CMP-YYYY-NNNN`
   sunucuda üretilir.
2. **Ekranlar:** yalnız aktif gemideki aktif ekranlar eklenebilir (toplu ≤100;
   biri uygun değilse hiçbiri eklenmez). Satırda o anki onaylı çarpan, saatler,
   loop/slot ve plan ∩ çalışma saati (haftalık saat) gösterilir. Saat ya da saat
   dilimi farklıysa değer `null` (“Hesaplanamadı”); playout kapasitesi
   **hesaplanmaz**, çünkü slot/loop kapasitesi henüz bilinmiyor.
3. **Ticari ve hedef (yalnız admin):** CPM/CPP/FIXED/PG, TRY/USD, birim fiyat,
   bütçe, sözleşmeli tutar/miktar, garanti impression, tolerans, pay oranları
   (ikisi de girilirse toplam 100). Spend hesaplanmaz. Birincil hedef
   PLAYOUTS veya IMPRESSIONS; ikisi ayrı birimdir.
4. **Kreatif:** MP4 (H.264), PNG veya JPEG, en fazla 200 MB. Tür dosya
   imzasından, süre/çözünürlük/codec `ffprobe` ile ölçülür, sha256 sunucuda
   hesaplanır. Teknik olarak geçen dosya `VALIDATING` olur ve ayrıca admin
   onayı (`APPROVED`) ister; geçmeyen dosya saklanmaz, `REJECTED` + neden kodu
   kaydedilir. Görsellerde gösterim süresi elle girilir (varsayılan yok).
   Onaylı kreatifin dosyası/metadata'sı değişmez; yeni sürüm `replacesId` ile.
   Aynı reklamverende aynı dosya ikinci kez yüklenemez (409). Antivirüs yok.
5. **Yayın planı:** kampanya geneli gün/saat dilimleri; gece yarısını aşan
   dilim izinli, aynı anda çakışan dilim reddedilir.
6. **Özet ve hazırlık:** `GET /campaigns/:id/validation` engelleri ve
   uyarıları döner. Engel varken `READY`/`LIVE` reddedilir.

## Durumlar

`DRAFT → READY → LIVE ⇄ PAUSED → COMPLETED`; `DRAFT/READY/PAUSED → CANCELLED`.
READY iken plan değişirse kayıt otomatik DRAFT'a döner (audit'te
`automatic: true`). `LIVE` için her aktif ekranda `CMS_UPLOADED` beyanı
gerekir. Pause/resume/iptal gerekçe ister. LIVE/PAUSED iken yalnız not ve
bitişi ileri uzatma; COMPLETED/CANCELLED salt okunur. Bitiş geçince otomatik
tamamlama yoktur, listede “Bitiş geçti” görünür. Eski şemadaki diğer durumlar
(ör. `READY_FOR_REVIEW`, `PAUSING`) bu akışta geçiş yapamaz (409).

## CMS işlem kaydı

`campaign_cms_operations` salt eklenir (UPDATE/DELETE/TRUNCATE trigger ve
uygulama rolü yetkisiyle engelli). Türler: `CMS_UPLOADED`,
`PLAYBACK_STARTED/PAUSED/RESUMED/STOPPED`, `NOTE`. Zaman geleceğe veya
kampanyadan önceye yazılamaz; yalnız kampanyadaki ekran için yazılır.
Düzeltme yeni kayıtla yapılır. LIVE/PAUSED geçişinde son beyanı uyuşmayan
ekranlar audit'e uyarı olarak yazılır.

## Depolama yapılandırması

| Değişken | Anlam |
|---|---|
| `STORAGE_DRIVER` | `local` veya `s3`. Boşsa üretim dışında OS geçici dizini; **üretimde yükleme kapalı (503)**. |
| `STORAGE_LOCAL_DIR` | `local` için mutlak dizin (kalıcı volume). |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` | S3 uyumlu servis; üretimde HTTPS zorunlu. |
| `FFPROBE_PATH` | Opsiyonel; API imajına `ffmpeg` paketi eklendi. |

Dosya yalnız admin oturumuyla `GET /creatives/:id/file` üzerinden akış olarak
sunulur; imzalı/herkese açık URL yoktur.

## Bilinen sınırlar

- Gerçek S3/bucket bağlantısı ve Compose `storage` profili bu ortamda
  **çalıştırılamadı** (Docker soketi yok); S3 sürücüsü sahte istemciyle birim
  testinden geçti.
- Antivirüs taraması, otomatik tamamlama, kapasite/pacing formülü, ajans/marka
  görünürlüğü ve teslimat girişi kapsam dışıdır.
- Depolamaya yazma DB işleminden önce yapılır; işlem düşerse nesne silinir,
  silme de başarısız olursa log'a “orphan creative object” yazılır.
