/**
 * @module tests/helpers/template-roots.test
 *
 * Проверяет реестр корней шаблонов — единственное место, которое знает, где лежит
 * каждый из трёх шаблонов после выноса двух из них в собственные репозитории.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  TEMPLATE_IDS,
  templateRoot,
  templateLayouts,
  templateManifest,
  templateStyles,
  externalTemplatesDir,
} from "./template-roots";

describe("реестр корней шаблонов", () => {
  it("знает все три шаблона", () => {
    expect(TEMPLATE_IDS).toEqual(["default", "certification", "standard-rt"]);
  });

  it("встроенный шаблон лежит в дереве продукта", () => {
    expect(templateRoot("default")).toBe(
      path.join(process.cwd(), "server", "scorm", "templates", "default"),
    );
  });

  it("вынесенные шаблоны адресуются от общего каталога репозиториев", () => {
    expect(templateRoot("certification")).toBe(
      path.join(externalTemplatesDir(), "skillum-template-certification", "template"),
    );
    expect(templateRoot("standard-rt")).toBe(
      path.join(externalTemplatesDir(), "skillum-template-standard-rt", "template"),
    );
  });

  it("каталог репозиториев переопределяется переменной окружения", () => {
    const prev = process.env.SKILLUM_TEMPLATES_DIR;
    process.env.SKILLUM_TEMPLATES_DIR = path.join("D:", "шаблоны");
    try {
      expect(externalTemplatesDir()).toBe(path.join("D:", "шаблоны"));
    } finally {
      if (prev === undefined) delete process.env.SKILLUM_TEMPLATES_DIR;
      else process.env.SKILLUM_TEMPLATES_DIR = prev;
    }
  });

  it("подкаталоги собираются от корня шаблона", () => {
    expect(templateLayouts("default")).toBe(path.join(templateRoot("default"), "layouts"));
    expect(templateStyles("certification")).toBe(path.join(templateRoot("certification"), "styles"));
    expect(templateManifest("standard-rt")).toBe(
      path.join(templateRoot("standard-rt"), "manifest.json"),
    );
  });

  // Тесты паритета обязаны ПАДАТЬ, а не тихо пропускаться, если вынесенного шаблона
  // нет на месте: молчаливый пропуск превращает зелёный прогон в ничего не значащий.
  it("каждый шаблон действительно доступен по своему пути", () => {
    for (const id of TEMPLATE_IDS) {
      expect(fs.existsSync(templateManifest(id)), `манифест шаблона «${id}» не найден`).toBe(true);
      expect(fs.existsSync(templateLayouts(id)), `макеты шаблона «${id}» не найдены`).toBe(true);
    }
  });
});
