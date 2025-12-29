import { buildZip } from "./zip";
import { buildTestJson, type ExportData } from "./builders/test-json";
import { buildManifest } from "./builders/manifest";
import { buildMetadataXml } from "./builders/metadata";
import { escapeXml } from "./utils/escape";
import { readAsset } from "./assets/read-asset";
import { extractEmbeddedMediaIntoAssets } from "./builders/media-assets";


function joinJsParts(parts: string[]) {
  return parts.filter(Boolean).join("\n;\n");
}

function readOneOf(paths: string[]) {
  const errors: string[] = [];
  for (const p of paths) {
    try {
      return readAsset(p);
    } catch (e: any) {
      errors.push(`${p}: ${e?.message ?? e}`);
    }
  }
  throw new Error("None of SCORM assets found:\n" + errors.join("\n"));
}

export async function generateScormPackage(data: ExportData): Promise<Buffer> {
  const testJson = buildTestJson(data);

  const indexHtml = readAsset("index.html").replace("__TITLE__", escapeXml(data.test.title));
  const runtimeJs = readAsset("runtime.js");
  const stylesCss = readAsset("styles.css");
  
  const testObj = JSON.parse(testJson);
  const { testObj: patchedTestObj, assets } = extractEmbeddedMediaIntoAssets(testObj);

  const appTpl = readAsset("app.js");
  const testJsonB64 = Buffer.from(JSON.stringify(patchedTestObj), "utf8").toString("base64");

  const appMain = appTpl; // app.js больше не содержит __TEST_JSON_B64__

  // ✅ утилиты подключаем ДО app.js
  const escapeHtmlJs = readOneOf([
    "app/utils/scorm/escapeHtml.js",
    "app/utils/escapeHtml.js",
  ]);

  const shuffleJs = readOneOf([
    "app/utils/scorm/shuffle.js",
    "app/utils/shuffle.js",
  ]);

  const suspendAttemptsJs = readOneOf([
    "app/utils/scorm/suspendAttempts.js",
    "app/utils/suspendAttempts.js",
  ]);

  const testDataJs = readOneOf([
    "app/bootstrap/testData.js",
    "app/scorm/testData.js", 
  ]);

  const bootstrapMainJs = readOneOf([
    "app/bootstrap/main.js",
  ]);

  const stateJs = readOneOf([
    "app/state.js",
  ]);

  const startPageJs = readOneOf([
    "app/render/startPage.js",
  ]);

  const resultsPageJs = readOneOf([
    "app/render/resultsPage.js",
  ]);

  const mainRenderJs = readOneOf([
    "app/render/mainRender.js",
  ]);

  const timerJs = readOneOf([
    "app/timer/timer.js",
  ]);

  const qSingleJs   = readOneOf(["app/render/questions/single.js"]);
  const qMultipleJs = readOneOf(["app/render/questions/multiple.js"]);
  const qMatchingJs = readOneOf(["app/render/questions/matching.js"]);
  const qRankingJs  = readOneOf(["app/render/questions/ranking.js"]);
  const qIndexJs    = readOneOf(["app/render/questions/index.js"]);
  const viewResultsJs = readOneOf(["app/render/viewResults.js"]);


  const matchingDndJs = readOneOf([
    "app/dnd/matching.js",
  ]);

  const rankingDndJs = readOneOf([
    "app/dnd/ranking.js",
  ]);

  const answerActionsJs = readOneOf([
    "app/actions/answers.js",
  ]);

  const feedbackJs = readOneOf([
    "app/feedback/feedback.js",
  ]);

  const questionMediaJs = readOneOf([
    "app/render/questionMedia.js",
  ]);

  const pdfExportJs = readOneOf([
    "app/utils/pdfExport.js",
  ]);

  const appJs = joinJsParts([
    escapeHtmlJs,
    shuffleJs,
    suspendAttemptsJs,
    testDataJs,
    stateJs,
    timerJs,
    qSingleJs,
    qMultipleJs,
    qMatchingJs,
    qRankingJs,
    qIndexJs,
    answerActionsJs,
    matchingDndJs,
    rankingDndJs,
    startPageJs,
    viewResultsJs,
    resultsPageJs,
    questionMediaJs,
    pdfExportJs,
    mainRenderJs,
    appMain,
    feedbackJs,
    bootstrapMainJs,
  ]).replace("__TEST_JSON_B64__", testJsonB64);

  const mediaHrefs = Object.keys(assets);

  const files: Record<string, string | Buffer> = {
    "imsmanifest.xml": buildManifest(data.test, data, mediaHrefs), 
    "metadata.xml": buildMetadataXml(data.test),
    "index.html": indexHtml,
    "styles.css": stylesCss,
    "runtime.js": runtimeJs,
    "app.js": appJs,
  };
  
  for (const [zipPath, buf] of Object.entries(assets)) {
    files[zipPath] = buf;
  }

  return buildZip(files);
}
