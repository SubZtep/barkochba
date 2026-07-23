import { expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { viewImageTool } from "../../tools/view-image"

test("view_image returns the path and mimeType for an existing image", async () => {
  const path = join(tmpdir(), "kaja-test-view-image.png")
  await Bun.write(path, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  const result = await viewImageTool.execute({ path })
  expect(result).toEqual({
    text: `Viewing image: ${path}`,
    images: [{ path, mimeType: "image/png" }]
  })
})

test("view_image reports a missing file", async () => {
  const result = await viewImageTool.execute({ path: "/no/such/file.png" })
  expect(result).toBe("File not found: /no/such/file.png")
})
