/**
 * A tiny in-memory stand-in for the aio-lib-db client: just the calls the app makes.
 * Filters: equality, $in, $gt, $gte, $lt, $lte. Updates: $set, $inc, $setOnInsert with upsert.
 * Like App Builder Database Storage, findOne rejects with "Document not found" on a miss, and
 * the unique indexes from db.js (usage `key`, profile `code`, reservation `quoteId`) reject
 * duplicates. Every call runs to completion before
 * the next starts (a single-document update is atomic), which is what the capacity check needs.
 */

const UNIQUE = {
  slot_profiles: ["code"],
  slot_reservations: ["quoteId"],
  slot_usage: ["key"],
};

function matchesCondition(value, condition) {
  if (condition && typeof condition === "object" && !Array.isArray(condition)) {
    if ("$in" in condition && !condition.$in.includes(value)) {
      return false;
    }
    if ("$gt" in condition && !(value > condition.$gt)) {
      return false;
    }
    if ("$gte" in condition && !(value >= condition.$gte)) {
      return false;
    }
    if ("$lt" in condition && !(value < condition.$lt)) {
      return false;
    }
    if ("$lte" in condition && !(value <= condition.$lte)) {
      return false;
    }
    return true;
  }
  return value === condition;
}

function matches(doc, query) {
  return Object.entries(query).every(([key, condition]) =>
    matchesCondition(doc[key], condition),
  );
}

function sortRows(list, spec) {
  const keys = Object.entries(spec);
  return [...list].sort((a, b) => {
    for (const [key, dir] of keys) {
      if (a[key] < b[key]) {
        return -dir;
      }
      if (a[key] > b[key]) {
        return dir;
      }
    }
    return 0;
  });
}

function cursor(docs) {
  let list = [...docs];
  const api = {
    sort(spec) {
      list = sortRows(list, spec);
      return api;
    },
    toArray: async () => list.map((doc) => ({ ...doc })),
  };
  return api;
}

function equalityFields(query) {
  return Object.fromEntries(
    Object.entries(query).filter(
      ([, value]) => value === null || typeof value !== "object",
    ),
  );
}

function applyUpdate(doc, update, inserting) {
  const next = { ...doc };
  if (inserting && update.$setOnInsert) {
    Object.assign(next, update.$setOnInsert);
  }
  if (update.$set) {
    Object.assign(next, update.$set);
  }
  for (const [key, by] of Object.entries(update.$inc ?? {})) {
    next[key] = (next[key] ?? 0) + by;
  }
  return next;
}

function duplicateError(field) {
  const error = new Error(`E11000 duplicate key error dup key: { ${field} }`);
  error.code = 11_000;
  return error;
}

export function createFakeDb({ failOn } = {}) {
  const collections = new Map();
  const calls = { closed: 0, ops: [] };

  const collection = (name) => {
    if (!collections.has(name)) {
      collections.set(name, []);
    }
    const docs = collections.get(name);
    const fail = (op) => {
      calls.ops.push(`${name}.${op}`);
      if (failOn?.(name, op)) {
        throw new Error(`fake failure in ${name}.${op}`);
      }
    };
    const checkUnique = (candidate, index) => {
      for (const field of UNIQUE[name] ?? []) {
        if (
          candidate[field] !== undefined &&
          docs.some((d, i) => i !== index && d[field] === candidate[field])
        ) {
          throw duplicateError(field);
        }
      }
    };

    const update = (query, change, options = {}) => {
      const index = docs.findIndex((doc) => matches(doc, query));
      if (index >= 0) {
        const before = docs[index];
        const after = applyUpdate(before, change, false);
        checkUnique(after, index);
        docs[index] = after;
        return { after, before, matchedCount: 1, modifiedCount: 1 };
      }
      if (options.upsert) {
        const after = applyUpdate(equalityFields(query), change, true);
        checkUnique(after, -1);
        docs.push(after);
        return {
          after,
          before: null,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 1,
        };
      }
      return { after: null, before: null, matchedCount: 0, modifiedCount: 0 };
    };

    return {
      createIndex: async () => "ok",
      deleteOne: async (query) => {
        fail("deleteOne");
        const index = docs.findIndex((doc) => matches(doc, query));
        if (index < 0) {
          return { deletedCount: 0 };
        }
        docs.splice(index, 1);
        return { deletedCount: 1 };
      },
      drop: async () => {
        docs.splice(0);
      },
      find: (query = {}) => {
        fail("find");
        return cursor(docs.filter((doc) => matches(doc, query)));
      },
      findOne: async (query) => {
        fail("findOne");
        const doc = docs.find((d) => matches(d, query));
        if (!doc) {
          const error = new Error(
            "Request x to v1/collection/c/findOne failed: Document not found",
          );
          error.httpStatusCode = 404;
          throw error;
        }
        return { _id: "x", ...doc };
      },
      findOneAndUpdate: async (query, change, options = {}) => {
        fail("findOneAndUpdate");
        const { after, before } = update(query, change, options);
        const doc = options.returnDocument === "after" ? after : before;
        return doc ? { _id: "x", ...doc } : null;
      },
      replaceOne: async (query, replacement, options = {}) => {
        fail("replaceOne");
        const index = docs.findIndex((doc) => matches(doc, query));
        if (index >= 0) {
          docs[index] = { ...replacement };
        } else if (options.upsert) {
          docs.push({ ...replacement });
        }
        return { acknowledged: true };
      },
      updateOne: async (query, change, options = {}) => {
        fail("updateOne");
        const {
          after: _after,
          before: _before,
          ...result
        } = update(query, change, options);
        return result;
      },
    };
  };

  const client = {
    close: async () => {
      calls.closed += 1;
    },
    collection,
  };

  return {
    calls,
    client,
    collections,
    connect: async () => client,
    docs: (name) => collections.get(name) ?? [],
    seed(name, docs) {
      collection(name);
      collections.get(name).push(...docs.map((doc) => ({ ...doc })));
    },
  };
}
