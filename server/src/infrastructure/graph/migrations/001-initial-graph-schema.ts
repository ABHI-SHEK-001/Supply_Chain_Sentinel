import { ConstraintType, EntityType, type Graph } from "falkordb";
import { NODE_LABELS } from "../schema.js";

function isAlreadyExists(err: unknown): boolean {
    return err instanceof Error && /already/i.test(err.message);
}

async function tolerateExisting(op: () => Promise<unknown>): Promise<void> {
    try {
        await op();
    } catch (err) {
        if (!isAlreadyExists(err)) throw err;
    }
}

/** Idempotent: every label gets a range index and a UNIQUE constraint on `id`. */
export async function applyInitialGraphSchema(graph: Graph): Promise<void> {
    for (const label of NODE_LABELS) {
        await tolerateExisting(() => graph.createNodeRangeIndex(label, "id"));
        await tolerateExisting(() =>
            graph.constraintCreate(ConstraintType.UNIQUE, EntityType.NODE, label, "id"),
        );
    }
}