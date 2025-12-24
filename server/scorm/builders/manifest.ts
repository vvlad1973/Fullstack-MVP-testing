import type { Test, TestSection, Topic, Question, TopicCourse, PassRule } from "@shared/schema";
import { escapeXml } from "../utils/escape";

interface ExportData {
  test: Test;
  sections: (TestSection & { topic: Topic; questions: Question[]; courses: TopicCourse[] })[];
}

export function buildManifest(test: Test, data: ExportData, extraFiles: string[] = []): string {
  const id = `test_${test.id}`;
  const overallPassRule = test.overallPassRuleJson as PassRule;
  const totalQuestions = data.sections.reduce((sum, s) => sum + s.drawCount, 0);

  const overallThreshold =
    overallPassRule.type === "percent"
      ? (overallPassRule.value / 100).toFixed(2)
      : totalQuestions > 0
        ? (overallPassRule.value / totalQuestions).toFixed(2)
        : "0.8";

  const objectives = data.sections
    .map((s) => {
      const topicPassRule = s.topicPassRuleJson as PassRule | null;
      let threshold = "0.5";
      if (topicPassRule) {
        threshold =
          topicPassRule.type === "percent"
            ? (topicPassRule.value / 100).toFixed(2)
            : (topicPassRule.value / s.drawCount).toFixed(2);
      }
      return `
        <imsss:objective objectiveID="obj_topic_${s.topic.id}">
          <imsss:minNormalizedMeasure>${threshold}</imsss:minNormalizedMeasure>
        </imsss:objective>`;
    })
    .join("");

  // ✅ manifest перечисляет реальные файлы, добавленные в zip
  const uniqueExtra = Array.from(new Set(extraFiles))
    .filter(Boolean)
    // на всякий: в manifest должны быть относительные пути
    .map((p) => p.replace(/^[\\/]+/, ""));

  const extraFileTags = uniqueExtra
    .map((href) => `      <file href="${escapeXml(href)}"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
    http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd
    http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd
    http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd
    http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">

  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
    <adlcp:location>metadata.xml</adlcp:location>
  </metadata>

  <organizations default="org_${id}">
    <organization identifier="org_${id}" structure="hierarchical">
      <title>${escapeXml(test.title)}</title>
      <item identifier="item_${id}" identifierref="res_${id}">
        <title>${escapeXml(test.title)}</title>
        <imsss:sequencing>
          <imsss:controlMode choice="true" flow="true" />
          <imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true" />
          <imsss:objectives>
            <imsss:primaryObjective objectiveID="primary_obj" satisfiedByMeasure="true">
              <imsss:minNormalizedMeasure>${overallThreshold}</imsss:minNormalizedMeasure>
            </imsss:primaryObjective>${objectives}
          </imsss:objectives>
        </imsss:sequencing>
        <adlnav:presentation>
          <adlnav:navigationInterface>
            <adlnav:hideLMSUI>continue</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>previous</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>abandon</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>exit</adlnav:hideLMSUI>
          </adlnav:navigationInterface>
        </adlnav:presentation>
      </item>
    </organization>
  </organizations>

  <resources>
    <resource identifier="res_${id}" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
      <file href="styles.css"/>
      <file href="runtime.js"/>
      <file href="app.js"/>
${extraFileTags ? extraFileTags + "\n" : ""}    </resource>
  </resources>
</manifest>`;
}
