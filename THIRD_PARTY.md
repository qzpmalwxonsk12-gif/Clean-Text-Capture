# Bundled PDF dependencies

All runtime files are local; PDF creation does not contact a CDN or conversion service.

- pdf-lib 1.17.1: https://github.com/Hopding/pdf-lib (MIT; vendor/pdf-lib.LICENSE.md).
- @pdf-lib/fontkit 1.1.1: https://www.npmjs.com/package/@pdf-lib/fontkit (MIT; vendor/fontkit.LICENSE.txt). The npm package identifies Andrew Dillon as author and Devon Govett as contributor. Its upstream repository does not currently supply a separate license file; the package's README and package.json declare MIT. The vendor notice reproduces those attributions and the standard MIT terms without inventing a copyright year.
- Noto Sans Regular: https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf (SIL Open Font License; fonts/NotoSans-LICENSE.txt).
- Noto Sans SC: https://github.com/google/fonts/tree/main/ofl/notosanssc (SIL Open Font License; fonts/NotoSansSC-OFL.txt). The bundled TTF is a static weight-400 instance generated from the published variable font using fontTools.varLib.instancer. Its font copyright/license metadata are retained.

The library versions are pinned in package-lock.json. Their browser UMD builds are copied unmodified from the corresponding npm package dist directories into vendor/. Noto Sans SC is embedded whole only when required, because subsetting it with this fontkit version can produce invisible glyphs. Latin text uses a small subset font.
