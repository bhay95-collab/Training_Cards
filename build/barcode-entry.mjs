// Only the Aztec encoder + SVG drawing, so the bundle stays small.
import { azteccode, drawingSVG } from 'bwip-js/browser';
window.makeAztec = (text) => azteccode({ text, scale: 4, paddingwidth: 0 }, drawingSVG());
