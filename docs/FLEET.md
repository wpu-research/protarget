# Filo / 3D

Story: `story/fleet-3d` (spec: `_bmad-output/implementation-artifacts/tech-spec-fleet-3d.md`).
Yalnız ADMIN. Menü: **Filo / 3D** (`/admin/fleet`). Yerel; Railway'e yayımlanmadı.

## Bölgeler

**İstanbul — Adalar** (varsayılan, stilize slayt haritası) ve **Boğaz** (üç köprü). Bölge seçici sağ üstte. Adalar hatları ve gemi atamaları simülasyondur.

## Ne gösterir

Stilize İstanbul Boğazı sahnesi (15 Temmuz Şehitler, Fatih Sultan Mehmet, Yavuz Sultan Selim köprüleri),
envanterdeki aktif **feribot** türü mekânlar ve ekranları. Gemiye (3D'de tıklayarak veya listeden
"Gemiye gir") kamera uçar, pencereden salona girer; W A S D/oklar + sürükleme ile gezilir, Esc çıkar.
Ekrana tıklayınca (veya listeden) ad, kod, çözünürlük, yön, boyut, çalışma saati, kampanya/kreatif
beyanı ve son CMS işlemi görünür.

## Dürüstlük kuralları

- **Konum ve hareket simülasyondur.** Sistemde AIS/konum verisi yok; gemiler kimliklerinden türeyen
  deterministik rotada gider. Ekranda sürekli "Simülasyon — gerçek konum değildir" yazar.
  Gerçek AIS sonraki story'dir.
- Ekran durumu kayıtlı envanter + **operatör beyanı**dır (READY/LIVE/PAUSED kampanyalar, son CMS işlemi);
  oynatma kanıtı değildir.
- Gemi içi ekran yerleşimi **şematiktir**; ekranın fiziksel konumu envanterde yoktur. Salona en fazla
  24 ekran konur (4 uç perde + 20 yan duvar), kalanı listede görünür.
- Bilinmeyen alan "Bilinmiyor"; ekran yüzeyine sahte kreatif çizilmez.
- Köprü aralıkları ölçeksizdir.

## API

`GET /api/v1/fleet/scene?includeInactive=true|false` (yalnız ADMIN, serializable okuma, mutation/audit yok).
En fazla 50 gemi, gemi başına 100 ekran; aşılırsa `shipsTruncated` / `screensTruncated`.
Konum, sahip kurum, ticari alan, CMS referansı dönmez.

## Kalite

Dar ekran, dokunmatik, ≤4 çekirdek, ≤4 GB bellek veya WebGL yoksa **Düşük** (DPR 1, yansımasız su,
daha az bina). Sağ üstten elle değişir. `prefers-reduced-motion` uçuşu anında yapar. WebGL yoksa liste
çalışmaya devam eder.

## Varlıklar

Tüm geometri/doku kodla üretilir (harici model yok). Kütüphaneler: three, @react-three/fiber, drei (MIT).

## Test

`pnpm --filter @protarget/web test` (saf mantık), `apps/api/test/fleet.unit-spec.ts`,
`apps/web/e2e/fleet.spec.ts` (yerel yığın ve seed gerekir).
