/**
 * @module server/routes/public-link
 * @description Author API of the public test link (stage 1): read, issue/rotate, disable.
 * Gated like the debug player — whoever may edit the test may hand it out publicly.
 */
import { Router, type Request } from "express";
import { randomBytes } from "crypto";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { requireTestScope } from "../middleware/test-scope";
import { publishedSnapshotOf } from "../services/test-snapshot";
import { logger } from "../logger";

const router = Router();
const gate = [requirePermission("tests.edit"), requireTestScope("edit")];

/** Absolute URL of a public link as the author should copy it. */
function linkUrl(req: Request, token: string): string {
  return `${req.protocol}://${req.get("host")}/p/${token}`;
}

router.get("/:id/public-link", ...gate, async (req, res) => {
  try {
    const [link, snapshot] = await Promise.all([
      storage.getTestPublicLink(req.params.id),
      publishedSnapshotOf(req.params.id),
    ]);
    res.json({ url: link ? linkUrl(req, link.token) : null, published: snapshot !== null });
  } catch (error) {
    logger.error("Public link read error: " + (error as Error).message, "public-link");
    res.status(500).json({ error: "Failed to read the public link" });
  }
});

router.post("/:id/public-link", ...gate, async (req, res) => {
  try {
    if (!(await publishedSnapshotOf(req.params.id))) {
      return res.status(409).json({ error: "Test is not published" });
    }
    const token = randomBytes(32).toString("hex");
    await storage.upsertTestPublicLink(req.params.id, token, req.session.userId!);
    logger.info(`Public link issued: test=${req.params.id} by user=${req.session.userId}`, "public-link");
    res.json({ url: linkUrl(req, token), published: true });
  } catch (error) {
    logger.error("Public link issue error: " + (error as Error).message, "public-link");
    res.status(500).json({ error: "Failed to issue the public link" });
  }
});

router.delete("/:id/public-link", ...gate, async (req, res) => {
  try {
    await storage.deleteTestPublicLink(req.params.id);
    logger.info(`Public link disabled: test=${req.params.id} by user=${req.session.userId}`, "public-link");
    res.json({ url: null, published: (await publishedSnapshotOf(req.params.id)) !== null });
  } catch (error) {
    logger.error("Public link disable error: " + (error as Error).message, "public-link");
    res.status(500).json({ error: "Failed to disable the public link" });
  }
});

export default router;
