# Источники геоданных

`water-objects.json` содержит производную выгрузку © OpenStreetMap contributors от 15 ноября 2026 года. Выгрузка доступна по лицензии [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Исходные идентификаторы десяти озёр перечислены в [спецификации](../../../docs/product-spec.md). [Условия OpenStreetMap](https://www.openstreetmap.org/copyright)

Озёра получены через Nominatim Lookup с `polygon_geojson=1` и `polygon_threshold=0`. Область Псковского озера включает залив Вярска в Эстонии. Она взята из общего контура Чудско-Псковского озера (1318060) после вычитания Чудского (17388038) и Тёплого (17388039) озёр. Из оставшихся областей выбрана та, у которой наибольшее перекрытие с исходным контуром Псковского озера (17388042). [Общий контур OpenStreetMap](https://www.openstreetmap.org/relation/1318060) · [Описание залива Вярска, Департамент здоровья Эстонии](https://www.terviseamet.ee/sites/default/files/documents/2024-09/varska_sanatooriumi_supluskoha_suplusvee_profiil.pdf)

Для Невы из линий собраны внешние и внутренние кольца, затем три полигона объединены. Контуры водоёмов упрощены с допуском 0,000025° с сохранением топологии. API отдаёт для карты те же области, по которым оценивает попадание. [2599821](https://www.openstreetmap.org/relation/2599821) · [1114249](https://www.openstreetmap.org/relation/1114249) · [1648985](https://www.openstreetmap.org/relation/1648985)

`reference-lines.geojson` содержит береговые линии и сухопутные границы Natural Earth 5.1.2 (1:50 млн), обрезанные по охвату карты. Эти обзорные линии не участвуют в оценке ответа. [Исходные векторы](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2/geojson) · [Условия Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)

Рельеф подгружается из Esri World Hillshade. Атрибуция поставщиков указана в ответе API. [Описание и условия сервиса Esri](https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer)
