# Oturum devri — 10 Kasım 2026

## Proje ve kayıt durumu

- Asıl proje: `/home/wpu/Desktop/Urunler/Protarget`.
- Branch: `story/phase-0-foundation`.
- Kod/deploy commit'i: `096bc8e`.
- Önceki yayın kanıtı commit'i: `aa4f29f`.
- `main`: `9d15c72`; Faz 0 kabulü tamamlanmış gibi merge yapılmadı.
- Geçici worktree: `/tmp/protarget-phase0-work`, detached HEAD.
  Devam ederken asıl proje klasörü kullanılmalı; `/tmp` kalıcılığına güvenilmemeli.
- Kullanıcının son isteği bu oturumdaki işi kaydetmek ve commit'lemek.
  Bu checkpoint yeni geliştirme, yeniden yayın veya remote push içermez.

## Ürün kararları

Öncelikli referans [MVP_DECISIONS.md](MVP_DECISIONS.md).

- MVP, kampanya/booking ve müşteri takip panelidir; gerçek DSP/SSP entegrasyonu
  veya dışarıda satın alınabilir Deal ID ilk sürümde yoktur.
- Operatör mevcut CMS'ye manuel yükleme yapar. CMS adı, işletim sistemi,
  API, çevrimdışı çalışma, slot/loop ve kapasite bilgileri henüz net değildir.
- Ekran bazlı çarpan başlangıçta manuel tanımlanır; geçmiş hesaplar korunur.
- Planlanan/gerçekleşen playout ve impression ayrıdır. Manuel operatör beyanı
  doğrulanmış proof-of-play gibi gösterilmez; veri kaynağı raporda belirtilir.
- Ajans/marka yalnız kendi kampanyasını salt okunur görür.
  Finansal görünürlük kurum bazlıdır ve varsayılan kapalıdır.
- Önceden durdurulan keşif formu işi kendiliğinden yeniden başlatılmamalı.

## Bu oturumda tamamlanan işler

- Giriş/çıkış, roller, kurum ve kullanıcı yönetimi, kurum izolasyonu ve audit
  içeren Faz 0 temeli kaydedildi.
- Railway ingress adresi web/API arasında imzalanıyor; keyfi forwarding
  başlıkları kimlik veya rate-limit anahtarı olarak kabul edilmiyor.
- Kullanıcı düzenleme, pasif kurumda pasifleştirme, davet/dil değişimi,
  SMTP sonucu yarışı, kurum seçimi ve test cleanup düzeltmeleri uygulandı.
- SMTP yapılandırılmadığı için canlıda yeni e-posta daveti açıkça kapalı.
- Kullanıcının logosundan gerçek alfa kanallı PNG türetildi:
  `apps/web/public/brand/protarget-mark.png`. Login ve panelde Protarget
  yazısının üzerinde gösteriliyor; orijinal görsel değiştirilmedi.
- Ayrı Railway projesi, kalıcı PostgreSQL, tek seferlik migration,
  özel ağdaki API ve HTTPS web yayımlandı.
- Runtime DB rolü migration sahibinden ayrıldı; sadece tek admin oluşturuldu,
  demo hesapları canlıya taşınmadı.

**Tamamlanmayan ürün modülleri:** gemi/ekran envanteri, kampanya, kreatif,
booking, teslimat/impression, pacing ve müşteri raporları. Menülerde planlanan
modüllerin bulunması bunların çalıştığı anlamına gelmez.

## Railway — son doğrulanmış durum

Bu kayıt, 10 Kasım 2026'da yapılan doğrulamayı anlatır; gelecekteki servis
durumu için yeniden kontrol gerekir.

- Panel: `https://web-production-570f712c.up.railway.app`.
- Project: `f03dbfdd-f270-4159-8d21-28a0dc288a49`, `protarget`.
- Production environment: `c2344e59-93dc-4b3f-bee0-19541f78cc79`.
- Migration: `b0dce91d-6a59-46df-90e6-06e44247c934`.
- API: `350cad58-6562-480b-a78c-fc07c442e8d9`.
- Web: `a219b2c3-2a01-4c06-ba92-76d0f89f2e83`.
- PostgreSQL: `94042150-4b58-4c88-887b-b2389a86c37a`.
- Son durum kontrolünde dört deployment da `SUCCESS`.

| Servis | Servis kimliği |
|---|---|
| Postgres | `61393a6b-3d8e-4077-b270-b3db5a932166` |
| migration | `e1566163-9498-4caf-8282-ba791148ec93` |
| api | `ec8d1efb-07d4-47e8-a717-53cdbf94ef1a` |
| web | `8bee842a-2134-4f96-9d66-68c42cfc8120` |

Doğru ayarlar, başarısız ilk denemeler ve tekrar yayın
notları [RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md) içindedir.
Sonraki yayın sırası: migration başarı → API health → web health → dış
HTTPS/browser kontrolü. İlk kurulumdaki paralel başlatma hatasını tekrarlama.

CLI `environment edit --service-config` ayarları kaydetmemişti;
`serviceInstanceUpdate` ile düzeltildi. Gerçek deployment ayarları mutlaka
kontrol edilmeli. Tek kullanımlık admin bootstrap değişkenleri başarılı
girişten sonra migration servisinden kaldırıldı; tekrar eklenmemeli.

## Test ve review kanıtı

- Build 8/8, typecheck 8 paket, lint başarılı.
- 19 unit + 40 gerçek PostgreSQL integration + 11 Chromium E2E
  + 2 web proxy testi = **72 başarılı yerel test**.
- Canlı Chromium: health, anonim erişim/yanlış Origin reddi, gerçek admin
  login, güvenli cookie'ler, kullanıcı/audit sayfaları, şeffaf logo,
  375 px mobil taşma kontrolü ve logout başarılı.
- Cloud PostgreSQL 18.6: kısıtlı runtime rolü, audit değiştirme ve migration
  metadata okuma yetkisinin olmaması, aktif admin 1, demo hesap 0 doğrulandı.
- Sahte ingress IP denemelerinin rate-limit bucket sayısı 0.
- Üç paralel CR-3 reviewer'ı odaklı R2-01/02 düzeltmelerinde yeni bulgu bulmadı.
- Bu checkpoint yalnız kayıt/kanıt ekler; test suite'leri yeniden çalıştırılmadı.

Git'teki kanıtlar:
[verification/2026-11-10-railway](verification/2026-11-10-railway).
Cloud çıktısı JSON alanlarına ayrılırken yalnız yerel SSH agent bildirimi
çıkarıldı; kontrol değerleri değiştirilmedi. Tam orijinal çıktılar
`.local/railway-verification-2026-11-10/` içinde korunur.

## Açık kabul işleri ve sıradaki adım

- Story **`review`** durumundadır. Docker socket erişimi olmadığından gerçek
  yerel Compose build/start/migration/restart kabulü henüz doğrulanmadı.
  Railway yayını bu testi geçmiş sayılmaz; story otomatik `done` yapılmamalı.
- [ACCEPTANCE.md](ACCEPTANCE.md), story dosyası ve
  `_bmad-output/implementation-artifacts/deferred-work.md` açık işlerin kaydıdır.
- F0-005/006/009/010/012 açık; F0-011 kısmi.
- R2-01/02 düzeltildi. R2-03/04/05/06/07/08 ertelendi.
- SMTP, yedek/restore tatbikatı, operasyonel alarm ve kalan production
  hardening işleri bitmiş kabul edilmemeli.
- Kullanıcı geliştirmeye devam istediğinde MVP sırasına göre envanter/ekran
  ve manuel çarpan story'si hazırlanır; gerçek CMS/DSP erişimi varsayılmaz.

## Gizli dosyalar ve yerel arşiv

- Admin e-postası: `admin@protarget.local`.
- Canlı parola: `.local/railway-login.txt`, dosya izni `0600`; Git dışında.
- Geçici yardımcı scriptler, CR diff'leri ve özel Railway kurulum durumu:
  `.local/session-2026-11-10/`. Dizin `0700`, dosyalar `0600`; Git dışında.
- Arşiv scriptleri tarihsel kopyalardır; sabit `/tmp` yolları içerebilir.
  Özellikle `configure.py` otomatik yeniden çalıştırılmamalı; kaldırılmış
  bootstrap değişkenlerini tekrar ekleyebilir.
- Orijinal `.env` ve `_vault` bu checkpoint sırasında okunmaz/değiştirilmez.
  Parola, token ve ham environment içeriği commit'e eklenmez.

## Codex izinleri hakkında kullanıcı sorusu

Kullanıcı sık izin sorulmasını azaltmak istedi. Oturumun ReklamAi klasöründe
açık olması, Protarget'ın yazılabilir kök dışında kalmasına neden oluyordu.
Protarget klasöründen başlatma ve otomatik onay değerlendirmesi seçenekleri
anlatıldı; sandbox'ı kaldırmanın riski açıklandı. Kullanıcının yerel Codex
ayarları değiştirilmedi. Devam eden ajan yürürlükteki izin politikasına uymalı.
