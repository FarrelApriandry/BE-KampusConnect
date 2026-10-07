import { sql } from "../../db/client";
import {
  AuthorizationError,
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/app-error";
import type { CurrentUser } from "../../plugins/api";
import { requireVerified } from "../../plugins/api";
import { getSellerReputation } from "../users/users.service";

const LISTING_COLUMNS = `l.id, l.seller_id, l.category_id, l.title, l.description,
  l.price, l.type, l.condition, l.meetup_location, l.status, l.created_at, l.updated_at`;

export const LISTING_STATUSES = ["ACTIVE", "RESERVED", "SOLD", "ARCHIVED"] as const;
export const LISTING_TYPES = ["PRODUCT", "SERVICE"] as const;
export const LISTING_CONDITIONS = [
  "NEW",
  "USED_LIKE_NEW",
  "USED_GOOD",
  "USED_FAIR",
  "FOR_PARTS",
  "NOT_APPLICABLE",
] as const;

export const SORTS = ["newest", "oldest", "price_asc", "price_desc", "relevance"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(id: string, code = "LISTING_NOT_FOUND"): void {
  if (!UUID_RE.test(id)) throw new NotFoundError("Listing tidak ditemukan", code);
}

export interface ListingImage {
  id: string;
  image_url: string;
  sort_order: number;
}

/** Ambil semua gambar untuk sekumpulan listing (hindari N+1). */
async function imagesByListingIds(ids: string[]): Promise<Map<string, ListingImage[]>> {
  const map = new Map<string, ListingImage[]>();
  if (ids.length === 0) return map;
  const rows = await sql`
    select id, listing_id, image_url, sort_order
    from listing_images
    where listing_id in ${sql(ids)}
    order by sort_order asc, id asc`;
  for (const r of rows as unknown as (ListingImage & { listing_id: string })[]) {
    const arr = map.get(r.listing_id) ?? [];
    arr.push({ id: r.id, image_url: r.image_url, sort_order: r.sort_order });
    map.set(r.listing_id, arr);
  }
  return map;
}

/** Seller ringkas + badge verifikasi (untuk card & detail). */
async function sellersByIds(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return map;
  const rows = await sql`
    select id, name, avatar_url, faculty, major, verification_status
    from users where id in ${sql(ids)}`;
  for (const r of rows as unknown as Record<string, unknown>[]) {
    map.set(r.id as string, r);
  }
  return map;
}

/** Kategori ringkas. */
async function categoriesByIds(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const clean = ids.filter(Boolean);
  if (clean.length === 0) return map;
  const rows = await sql`select id, name, type from categories where id in ${sql(clean)}`;
  for (const r of rows as unknown as Record<string, unknown>[]) {
    map.set(r.id as string, r);
  }
  return map;
}

export interface ListListingsQuery {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  type?: string;
  condition?: string;
  status?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  sellerId?: string;
}

/**
 * GET /listings — search + filter + sort + pagination.
 * Default hanya listing ACTIVE (BR-03: listing non-aktif tak menerima transaksi baru).
 */
export async function listListings(q: ListListingsQuery) {
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(q.limit ?? 20) || 20));
  const offset = (page - 1) * limit;
  const sort = (SORTS as readonly string[]).includes(q.sort ?? "") ? q.sort! : "newest";

  if (q.type && !(LISTING_TYPES as readonly string[]).includes(q.type)) {
    throw new ValidationError(`type harus salah satu dari: ${LISTING_TYPES.join(", ")}`);
  }
  if (q.condition && !(LISTING_CONDITIONS as readonly string[]).includes(q.condition)) {
    throw new ValidationError(`condition harus salah satu dari: ${LISTING_CONDITIONS.join(", ")}`);
  }
  if (q.status && !(LISTING_STATUSES as readonly string[]).includes(q.status)) {
    throw new ValidationError(`status harus salah satu dari: ${LISTING_STATUSES.join(", ")}`);
  }
  if (q.category && !UUID_RE.test(q.category)) {
    throw new ValidationError("category harus berupa UUID");
  }
  if (q.sellerId && !UUID_RE.test(q.sellerId)) {
    throw new ValidationError("sellerId harus berupa UUID");
  }
  const minPrice = q.minPrice !== undefined ? Number(q.minPrice) : undefined;
  const maxPrice = q.maxPrice !== undefined ? Number(q.maxPrice) : undefined;
  if (minPrice !== undefined && (Number.isNaN(minPrice) || minPrice < 0)) {
    throw new ValidationError("minPrice tidak valid");
  }
  if (maxPrice !== undefined && (Number.isNaN(maxPrice) || maxPrice < 0)) {
    throw new ValidationError("maxPrice tidak valid");
  }
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    throw new ValidationError("minPrice tidak boleh lebih besar dari maxPrice");
  }

  const term = q.search?.trim() ? `%${q.search.trim()}%` : null;

  const filters = sql`
    ${q.status ? sql`and l.status = ${q.status}` : sql`and l.status = 'ACTIVE'`}
    ${q.category ? sql`and l.category_id = ${q.category}` : sql``}
    ${q.type ? sql`and l.type = ${q.type}` : sql``}
    ${q.condition ? sql`and l.condition = ${q.condition}` : sql``}
    ${q.sellerId ? sql`and l.seller_id = ${q.sellerId}` : sql``}
    ${minPrice !== undefined ? sql`and l.price >= ${minPrice}` : sql``}
    ${maxPrice !== undefined ? sql`and l.price <= ${maxPrice}` : sql``}
    ${term ? sql`and (l.title ilike ${term} or l.description ilike ${term})` : sql``}`;

  // 'relevance': judul cocok lebih dulu, lalu listing terbaru.
  const orderBy =
    sort === "price_asc"
      ? sql`l.price asc, l.created_at desc`
      : sort === "price_desc"
        ? sql`l.price desc, l.created_at desc`
        : sort === "oldest"
          ? sql`l.created_at asc`
          : sort === "relevance" && term
            ? sql`(l.title ilike ${term}) desc, l.created_at desc`
            : sql`l.created_at desc`;

  const countRows = await sql`
    select count(*)::int as total from listings l where true ${filters}`;
  const total = (countRows[0] as unknown as { total: number }).total;

  const rows = await sql`
    select ${sql.unsafe(LISTING_COLUMNS)}
    from listings l
    where true ${filters}
    order by ${orderBy}
    limit ${limit} offset ${offset}`;
  const listings = rows as unknown as Record<string, unknown>[];

  const ids = listings.map((l) => l.id as string);
  const [images, sellers, categories] = await Promise.all([
    imagesByListingIds(ids),
    sellersByIds([...new Set(listings.map((l) => l.seller_id as string))]),
    categoriesByIds([...new Set(listings.map((l) => l.category_id as string).filter(Boolean))]),
  ]);

  const items = listings.map((l) => ({
    ...l,
    price: Number(l.price),
    images: images.get(l.id as string) ?? [],
    seller: sellers.get(l.seller_id as string) ?? null,
    category: categories.get(l.category_id as string) ?? null,
  }));

  return { items, page, limit, total, hasNext: offset + items.length < total };
}

export interface CreateListingInput {
  title: string;
  description?: string;
  categoryId?: string | null;
  type?: string;
  price: number;
  condition?: string | null;
  meetupLocation?: string;
  images?: string[];
}

function validateListingPayload(input: CreateListingInput, partial = false): void {
  if (!partial || input.title !== undefined) {
    const title = (input.title ?? "").trim();
    if (title.length < 3) throw new ValidationError("Judul minimal 3 karakter");
    if (title.length > 120) throw new ValidationError("Judul maksimal 120 karakter");
  }
  if (!partial || input.price !== undefined) {
    if (typeof input.price !== "number" || Number.isNaN(input.price) || input.price < 0) {
      throw new ValidationError("Harga harus angka >= 0");
    }
  }
  if (input.type !== undefined && !(LISTING_TYPES as readonly string[]).includes(input.type)) {
    throw new ValidationError(`type harus salah satu dari: ${LISTING_TYPES.join(", ")}`);
  }
  if (
    input.condition !== undefined &&
    input.condition !== null &&
    !(LISTING_CONDITIONS as readonly string[]).includes(input.condition)
  ) {
    throw new ValidationError(`condition harus salah satu dari: ${LISTING_CONDITIONS.join(", ")}`);
  }
  if (input.categoryId !== undefined && input.categoryId !== null && !UUID_RE.test(input.categoryId)) {
    throw new ValidationError("categoryId harus berupa UUID");
  }
  if (input.images !== undefined) {
    if (!Array.isArray(input.images)) throw new ValidationError("images harus array URL");
    if (input.images.length > 8) throw new ValidationError("Maksimal 8 gambar per listing");
    for (const url of input.images) {
      if (typeof url !== "string" || url.trim().length === 0) {
        throw new ValidationError("URL gambar tidak valid");
      }
    }
  }
}

async function assertCategoryExists(categoryId: string | null | undefined): Promise<void> {
  if (!categoryId) return;
  const rows = await sql`select id from categories where id = ${categoryId}`;
  if (rows.length === 0) throw new NotFoundError("Kategori tidak ditemukan", "CATEGORY_NOT_FOUND");
}

/** POST /listings — BR-02: hanya akun VERIFIED + ACTIVE yang boleh membuat listing. */
export async function createListing(me: CurrentUser, input: CreateListingInput) {
  requireVerified(me);
  validateListingPayload(input);
  await assertCategoryExists(input.categoryId);

  const rows = await sql`
    insert into listings (seller_id, category_id, title, description, price, type, condition, meetup_location)
    values (${me.id}, ${input.categoryId ?? null}, ${input.title.trim()},
            ${(input.description ?? "").trim()}, ${input.price},
            ${input.type ?? "PRODUCT"}, ${input.condition ?? null},
            ${(input.meetupLocation ?? "").trim()})
    returning id`;
  const id = (rows[0] as unknown as { id: string }).id;

  if (input.images?.length) {
    await replaceImages(id, input.images);
  }
  return getListingById(id, me);
}

async function replaceImages(listingId: string, urls: string[]): Promise<void> {
  await sql`delete from listing_images where listing_id = ${listingId}`;
  if (urls.length === 0) return;
  const values = urls.map((url, i) => ({ listing_id: listingId, image_url: url.trim(), sort_order: i }));
  await sql`insert into listing_images ${sql(values)}`;
}

/** Ambil listing + relasi. `viewer` dipakai untuk menandai kepemilikan. */
export async function getListingById(
  id: string,
  viewer?: CurrentUser,
  opts: { withReputation?: boolean } = {},
) {
  assertUuid(id);
  const rows = await sql`
    select ${sql.unsafe(LISTING_COLUMNS)}
    from listings l where l.id = ${id}`;
  const listing = rows[0] as unknown as Record<string, unknown> | undefined;
  if (!listing) throw new NotFoundError("Listing tidak ditemukan", "LISTING_NOT_FOUND");

  const sellerId = listing.seller_id as string;
  const [images, sellers, categories, reputation] = await Promise.all([
    imagesByListingIds([id]),
    sellersByIds([sellerId]),
    categoriesByIds([listing.category_id as string | null].filter(Boolean) as string[]),
    opts.withReputation
      ? getSellerReputation(sellerId).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    ...listing,
    // NUMERIC dari driver postgres datang sebagai string — normalkan ke number
    // sesuai kontrak SDD §10 ("price": 45000).
    price: Number(listing.price),
    images: images.get(id) ?? [],
    seller: sellers.get(sellerId) ?? null,
    // FR-07: detail listing menampilkan ringkasan reputasi seller.
    sellerReputation: reputation,
    category: categories.get(listing.category_id as string) ?? null,
    isOwner: viewer ? viewer.id === sellerId : false,
  };
}

/** Cek ownership — BR-08: user hanya boleh mengubah resource miliknya (kecuali admin). */
async function loadOwnedListing(id: string, me: CurrentUser) {
  assertUuid(id);
  const rows = await sql`select seller_id, status from listings where id = ${id}`;
  const row = rows[0] as unknown as { seller_id: string; status: string } | undefined;
  if (!row) throw new NotFoundError("Listing tidak ditemukan", "LISTING_NOT_FOUND");
  if (row.seller_id !== me.id && me.role !== "ADMIN") {
    throw new AuthorizationError("Bukan listing milik kamu", "NOT_LISTING_OWNER");
  }
  return row;
}

export interface UpdateListingInput extends Partial<CreateListingInput> {
  status?: string;
}

/** PATCH /listings/:id */
export async function updateListing(me: CurrentUser, id: string, input: UpdateListingInput) {
  const existing = await loadOwnedListing(id, me);
  validateListingPayload(input as CreateListingInput, true);

  if (input.status !== undefined) {
    if (!(LISTING_STATUSES as readonly string[]).includes(input.status)) {
      throw new ValidationError(`status harus salah satu dari: ${LISTING_STATUSES.join(", ")}`);
    }
    if (input.status === existing.status) {
      throw new BusinessRuleError(
        `Listing sudah berstatus ${input.status}`,
        "STATUS_UNCHANGED",
        409,
      );
    }
  }
  if (input.categoryId !== undefined) await assertCategoryExists(input.categoryId);

  await sql`
    update listings set
      title = ${input.title === undefined ? sql`title` : input.title.trim()},
      description = ${input.description === undefined ? sql`description` : input.description.trim()},
      category_id = ${input.categoryId === undefined ? sql`category_id` : (input.categoryId ?? null)},
      price = ${input.price === undefined ? sql`price` : input.price},
      type = ${input.type === undefined ? sql`type` : input.type},
      condition = ${input.condition === undefined ? sql`condition` : (input.condition ?? null)},
      meetup_location = ${input.meetupLocation === undefined ? sql`meetup_location` : input.meetupLocation.trim()},
      status = ${input.status === undefined ? sql`status` : input.status},
      updated_at = now()
    where id = ${id}`;

  if (input.images !== undefined) {
    await replaceImages(id, input.images);
  }
  return getListingById(id, me);
}

/** DELETE /listings/:id — soft delete ke ARCHIVED (riwayat transaksi tetap utuh). */
export async function archiveListing(me: CurrentUser, id: string) {
  await loadOwnedListing(id, me);
  await sql`update listings set status = 'ARCHIVED', updated_at = now() where id = ${id}`;
  return { id, status: "ARCHIVED" };
}
