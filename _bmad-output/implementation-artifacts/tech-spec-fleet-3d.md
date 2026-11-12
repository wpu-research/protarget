---
title: 'Filo / 3D — İstanbul Boğazı simülasyonunda gemi ve ekran görünümü (admin)'
type: 'feature'
created: '2026-11-12'
status: 'review'
acceptance_status: 'review'
target_file: 'tech-spec-fleet-3d.md'
branch: 'story/fleet-3d'
baseline_commit: '0d21fce'
context:
  - 'docs/INVENTORY.md'
  - 'docs/CAMPAIGNS.md'
  - 'docs/MVP_DECISIONS.md'
---

# Filo / 3D — Boğaz simülasyonu

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Gemi ve ekran envanteri yalnız tablo olarak görülebiliyor. Admin, filoyu mekânsal olarak (Boğaz, köprüler, gemiler, gemi içindeki ekranlar) görmek ve bir ekranın envanter + kampanya/CMS beyanı durumunu yerinde incelemek istiyor.

**Kullanıcı isteği (12 Kasım 2026):** Gemileri ve ekranları "gerçek zamanlı" görebileceğimiz ayrı sekme; 3D gerçekçi İstanbul Boğazı, köprüler civarında adlarıyla gemiler; gemiye tıklayınca kamera yavaşça içine girsin, içeride gezilip ekranlara bakılsın.

**Kullanıcı kararı (12 Kasım 2026) — "gerçek zamanlı" = seçenek (a):** Sistemde AIS/konum verisi yoktur; gemi ve ekranlar manuel envanterdir. Gemiler Boğaz'da **simüle edilmiş rota** üzerinde hareket eder ve ekranda "Simülasyon — gerçek konum değildir" etiketi taşır. Ekran durumu kayıtlı envanter + kampanya/CMS **operatör beyanından** gelir ve "operatör beyanıdır, oynatma kanıtı değildir" notuyla gösterilir. Gerçek AIS beslemesi (harici/ücretli servis) **sonraki story**'dir; bu story'de yoktur.

**Approach:** Yalnız-okuma `GET /api/v1/fleet/scene` (yalnız ADMIN) gemileri (venue type=`ferry`), ekranlarını ve ekran bazlı kampanya beyanlarını tek yanıtla verir. Web'de `/admin/fleet` sekmesi three.js / react-three-fiber ile stilize Boğaz sahnesini çizer; tüm geometri/doku kodla üretilir (harici model/doku yok). Gemi seçimi → kamera uçuşu → gemi içi birinci kişi gezinti → ekran tıklama → ayrıntı paneli. Yan panel aynı bilgiyi 3D'siz (erişilebilir liste) sunar; WebGL yoksa yalnız liste çalışır.

## Boundaries & Constraints

**Always:** Yalnız ADMIN okur (`sessions.requireAdmin`, serializable okuma transaction'ı); bu özellik mutation içermez, dolayısıyla audit satırı yazılmaz. Bilinmeyen değer `null` ve arayüzde "Bilinmiyor"; uydurma çözünürlük/boyut/konum yok. Hareket ve konum **simülasyon** olarak etiketlenir; gemi içi ekran yerleşimi **şematiktir** (envanterde ekranın gemideki fiziksel konumu yoktur, `locationLabel` yalnız metin olarak gösterilir). Ekran yüzeyinde sahte kreatif/yayın görüntüsü çizilmez (yalnız ekran kodu + çözünürlük). Durum rozetleri "operatör beyanı" notu taşır. TR öncelikli, EN tam; metinler `packages/i18n`'de. Ekran okuyucu/klavye için 3D'siz liste her zaman mevcut. Mobil/zayıf GPU/`prefers-reduced-motion` için düşük kalite ve hareketsiz geçiş. Dosya/varlık: yalnız kodla üretilen geometri; lisanslı model/doku/font dosyası yok.

**Ask First:** Gerçek AIS/konum servisi, harici model/doku, `venues`'a konum alanı eklemek veya ekranlara gemi içi koordinat eklemek (migration), ekrana canlı/yayın görüntüsü, Railway'e yayın, push, `main`'e merge.

**Never:** Simüle konumu gerçek gibi göstermek; "canlı/çevrimiçi/oynuyor" gibi doğrulanmamış oynatma iddiası; player/PoP/impression/teslimat verisi; mutation veya yeni yazma rotası; gizli değer/kurum verisi sızdırmak (yalnız ADMIN zaten; yine de sahip kurum, ticari alanlar, CMS referansı yanıtta yoktur); üretim verisine yazmak.

## I/O & Edge-Case Matrix

| Senaryo | Girdi / Durum | Beklenen | Hata |
|---|---|---|---|
| Okuma | ADMIN, `GET /fleet/scene` | Aktif `ferry` venue'ler (≤50), her birinde aktif ekranlar (≤100) ve ekran başına beyanlar | 401/403 yetkisiz roller |
| Pasifler | `includeInactive=true` | Pasif gemi/ekranlar `active:false` ile gelir; arayüz soluk gösterir | — |
| Ferry dışı venue | mall/metro/… | Dönmez (sahnede gemi yok) | — |
| Kesilme | >50 gemi / >100 ekran | `truncated: true`, arayüz uyarır | — |
| Beyan | Ekran READY/LIVE/PAUSED kampanyada aktif | `{kod, ad, durum, kreatif durum sayıları, son CMS işlemi}`; arayüz "operatör beyanı" der | — |
| Beyan yok | Hiçbir kampanyada değil | `declarations: []` → "Bu ekranda kayıtlı kampanya beyanı yok" | — |
| Çözünürlük yok | `resolutionWidth/Height null` | 16:9 çizim, ayrıntıda "Bilinmiyor" | — |
| Çok ekran | Gemide >24 ekran | İlk 24 şematik yerleşimde, kalanı listede "yerleşimde gösterilmedi" | — |
| WebGL yok / kontekst kaybı | — | Liste + uyarı; hata ekranı yok | — |
| Gemi yok | Aktif ferry yok | Boş durum metni, Boğaz yine çizilir | — |

## Kabul ölçütleri

1. ADMIN dışındaki roller `/admin/fleet` ve `/fleet/scene`'e erişemez.
2. Sahne Boğaz, üç köprü (15 Temmuz Şehitleri, Fatih Sultan Mehmet, Yavuz Sultan Selim), su, gökyüzü ve gemileri adlarıyla çizer; gemiler simüle rotada hareket eder; "Simülasyon" etiketi her zaman görünür.
3. Gemi (3D'de veya listeden) seçilince kamera yaklaşıp içeri geçer; içeride WASD/oklar + sürükleyerek bakma, dokunmatikte ekran düğmeleri; Esc/Çık düğmesi dışarı döner.
4. Ekrana tıklayınca ad, kod, çözünürlük, yön, boyut, çalışma saati, kampanya/kreatif beyan durumu ve "operatör beyanıdır" notu görünür.
5. Düşük kalite otomatik seçilir (dar ekran/dokunmatik/az çekirdek-bellek/WebGL güvensiz) ve elle değiştirilebilir.
6. typecheck, lint, build temiz; ilgili birim testler ve (ortam elveriyorsa) Playwright duman testi çalıştırılır; çalıştırılamayan açıkça yazılır.

</frozen-after-approval>

## Teknik tasarım

- **API:** `apps/api/src/modules/fleet` (`fleet.module/controller/service/dto`). Tek serializable okuma transaction'ı: `venue(type=ferry)` → `screen(deletedAt=null)` → `campaignScreen(active, campaign.status ∈ READY/LIVE/PAUSED, deletedAt=null)` + `campaignCreative→creative.status` sayıları + ekran/kampanya başına son `CampaignCmsOperation`. Seçim yalnız gerekli alanları alır. Paylaşılan tipler `packages/shared/src/fleet.ts`. `docs/openapi.json` yeniden üretilir.
- **Web:** `/admin/fleet` (`[[...slug]]` içinde), nav `nav.fleet`. `FleetView` (istemci) `next/dynamic(ssr:false)` ile `FleetScene` (R3F) yükler → ilk yük hafif kalır. Saf mantık `lib/fleet-sim.ts` (rota, kalite seçimi, ekran boyutu/yerleşimi) ayrıca birim testlidir.
- **Sahne (hepsi kodla üretilir):** gökyüzü (`Sky`), su (`Water` + kodla üretilen normal haritası; düşük kalitede düz malzeme), yükseklik alanı kıyılar, örnekli bina kutuları, üç köprü (kuleler, tabliye, askılar/halatlar), parametrik feribot (gövde extrude, güverte, baca), gemi içi salon (zemin, tavan, pencere boşlukları, koltuklar, duvar ekranları).
- **Kamera:** genel bakış `OrbitControls`; seçimde bezier uçuş (≈3,5 sn, `reduced-motion`'da anında) → kararma geçişi → gemi içi birinci kişi. Gemi içindeyken seçili gemi durur (hareket tutması yok).
- **Rota:** gemi kimliğinden deterministik şerit/ofset/faz; Boğaz merkez hattında gidip gelen, 15 Temmuz ↔ Yavuz Sultan Selim arası stilize ve **ölçeksiz** (köprü aralıkları sıkıştırılmıştır).
- **Kalite:** `detectQuality()` — dar ekran, `pointer: coarse`, `hardwareConcurrency ≤ 4`, `deviceMemory ≤ 4`, WebGL yok → `low` (DPR 1, gölge yok, su yansıması yok, az bina, düşük segment).

## Doğrulama planı

API birim (sunum/sınır dönüşümleri), API entegrasyon (yetki, kapsam, kesilme — veritabanı gerektirir), web birim (`node --test`, `fleet-sim`), Playwright duman (ADMIN sekmesi, liste, gemiye gir, ekran ayrıntısı, TR/EN, mobil düşük kalite), `pnpm build/typecheck/lint`.

## Uygulama kaydı

- **Uygulandı (12 Kasım 2026):** `GET /api/v1/fleet/scene` (ADMIN, yalnız okuma, audit yok), `packages/shared/src/fleet.ts`, `/admin/fleet` sekmesi (`nav.fleet`), `components/fleet/*` (R3F: Boğaz, 3 köprü, gemi, salon, kamera uçuşu, gezinti, ekran ayrıntısı), `lib/fleet-sim.ts`, TR/EN anahtarları (`fleet.*`), `docs/FLEET.md`.
- **Referans düzeltmesi:** Kullanıcının paylaştığı gerçek gemi içi görsellere göre salon güncellendi: ekranlar uç perdelerde (2+2, kapının iki yanı) ve yan duvarlarda; sıralar ekranlara bakar; tavan ışık panelleri. Yerleşim yine **şematiktir**.
- **Gerçekçilik turu (12 Kasım):** salon referans render'a yaklaştırıldı: karo doku zemin/tavan, gömme ışık diskleri, ahşap pencere çerçevesi, uç perde kapıları, mavi/kırmızı sıralar + kol dayama. Ekran yüzeyi Protarget **marka bekleme ekranı**dır (kampanya kreatifi veya yayın değil).
- **Sonraki story adayı:** Kullanıcının sunumundaki ulaşım ağı (Sarıyer, Beşiktaş, Kabataş, Eminönü, Karaköy, Kadıköy, Bostancı → Kınalıada, Burgazada, Heybeliada, Büyükada) Boğaz değil Adalar hattıdır; sahne ve rotalar buna göre genişletilebilir (karar bekliyor).
- **Bağımlılıklar:** `three@0.187.0`, `@react-three/fiber@9.8.2`, `@react-three/drei@10.7.9` (OrbitControls), `@types/three`. Hepsi MIT; harici model/doku/font yok. drei `Html` React 19'da iç içe kök hatası verdiği için etiketler `CSS2DRenderer` ile çizilir.
- **Doğrulama (bu oturumda çalıştırıldı, Node 22.22.2):** `pnpm typecheck` 11/11, `pnpm build` 8/8, `pnpm lint` temiz, web birim (`node --test`) 14/14 (12 fleet-sim + 2 proxy), API birim `fleet` 3/3. Tarayıcıda (dev sunucu, sahte veriyle, yazılım WebGL) elle görüldü: genel bakış, gemiye uçuş, salon, ekran düğümleri. Etiket/bağlantı akışı çalıştı.
- **Çalıştırılamadı:** Playwright (`e2e/fleet.spec.ts` yazıldı; yerel API/DB/seed yok), API entegrasyon testi yazılmadı (DB yok), tam API birim paketi (repo Node ≥24.9 ister; bu makinede 20/22 var — `fleet` birim testi ESM'siz sunumcu ayrıldığı için çalıştı), `docs/openapi.json` yeniden üretimi (`pnpm local openapi` DB ister), mobil gerçek cihaz, gerçek GPU performansı. Pozitif `/fleet/scene` verisi (beyan/CMS sıralaması) yalnız birim testle doğrulandı.
- **Bilinen sınırlar:** Su yansıması yüksek kalitede ağır (yazılım GL'de ilk kare ~10 sn); ekran yüzeyinde yalnız kod+çözünürlük çizilir; >24 ekran şematik yerleşime girmez (listede); gemi içi dış güverte/dikey direk ekranları modellenmedi.
