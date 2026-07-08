import { describe, expect, test } from "bun:test"
import { createAsyncQueue } from "./audio"

describe("createAsyncQueue", () => {
	test("yields pushed items in order and ends", async () => {
		const q = createAsyncQueue<number>()
		q.push(1)
		q.push(2)
		q.end()
		const items: number[] = []
		for await (const item of q) items.push(item)
		expect(items).toEqual([1, 2])
	})

	test("wakes a waiting consumer", async () => {
		const q = createAsyncQueue<string>()
		const consumed = (async () => {
			const items: string[] = []
			for await (const item of q) items.push(item)
			return items
		})()
		await Bun.sleep(1) // let the consumer start waiting
		q.push("a")
		q.push("b")
		q.end()
		expect(await consumed).toEqual(["a", "b"])
	})

	test("drain removes queued items without ending the queue", async () => {
		const q = createAsyncQueue<number>()
		q.push(1)
		q.push(2)
		expect(q.drain()).toEqual([1, 2])
		expect(q.drain()).toEqual([])
		q.push(3)
		q.end()
		const items: number[] = []
		for await (const item of q) items.push(item)
		expect(items).toEqual([3])
	})

	test("push after end is a no-op", async () => {
		const q = createAsyncQueue<number>()
		q.push(1)
		q.end()
		q.push(2)
		const items: number[] = []
		for await (const item of q) items.push(item)
		expect(items).toEqual([1])
	})
})
