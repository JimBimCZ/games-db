import { desc } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const hydrationState = pgEnum('hydration_state', [
  'pending',
  'ok',
  'failed',
  'unavailable',
])

export const libraryStatus = pgEnum('library_status', [
  'backlog',
  'playing',
  'finished',
  'abandoned',
  'wishlist',
])

export const mediaKind = pgEnum('media_kind', ['screenshot', 'movie'])

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified', { mode: 'date', withTimezone: true }),
  image: text('image'),
})

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
)

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
)

export const steamApp = pgTable(
  'steam_app',
  {
    appid: integer('appid').primaryKey(),
    name: text('name').notNull(),
    appType: text('app_type'),
    lastSeenInListAt: timestamp('last_seen_in_list_at', { withTimezone: true }),
    steamLastModified: timestamp('steam_last_modified', { withTimezone: true }),
    priceChangeNumber: integer('price_change_number'),
    hydrationState: hydrationState('hydration_state').notNull().default('pending'),
    failureCount: integer('failure_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  },
  (t) => [
    index('steam_app_queue_idx').on(
      t.hydrationState,
      t.nextAttemptAt,
      t.appType,
      desc(t.steamLastModified),
    ),
  ],
)

export const game = pgTable(
  'game',
  {
    appid: integer('appid')
      .primaryKey()
      .references(() => steamApp.appid, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    isFree: boolean('is_free').notNull().default(false),
    shortDescription: text('short_description'),
    aboutHtml: text('about_html'),
    detailedHtml: text('detailed_html'),
    headerImage: text('header_image'),
    capsuleImage: text('capsule_image'),
    backgroundRaw: text('background_raw'),
    releaseDateText: text('release_date_text'),
    releaseComingSoon: boolean('release_coming_soon').notNull().default(false),
    releaseDate: timestamp('release_date', { withTimezone: true }),
    developers: text('developers').array(),
    publishers: text('publishers').array(),
    platforms: jsonb('platforms'),
    metacriticScore: smallint('metacritic_score'),
    metacriticUrl: text('metacritic_url'),
    recommendationsTotal: integer('recommendations_total'),
    achievementsTotal: integer('achievements_total'),
    supportedLanguagesRaw: text('supported_languages_raw'),
    contentDescriptorIds: integer('content_descriptor_ids').array(),
    contentDescriptorNotes: text('content_descriptor_notes'),
    dlcAppids: integer('dlc_appids').array(),
    pcRequirements: jsonb('pc_requirements'),
    macRequirements: jsonb('mac_requirements'),
    linuxRequirements: jsonb('linux_requirements'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('game_type_idx').on(t.type),
    index('game_release_date_idx').on(t.releaseDate),
    index('game_name_idx').on(t.name),
  ],
)

export const gameMedia = pgTable(
  'game_media',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    appid: integer('appid')
      .notNull()
      .references(() => game.appid, { onDelete: 'cascade' }),
    kind: mediaKind('kind').notNull(),
    position: integer('position').notNull(),
    steamMediaId: integer('steam_media_id'),
    name: text('name'),
    thumbnailUrl: text('thumbnail_url'),
    fullUrl: text('full_url'),
    hlsUrl: text('hls_url'),
    dashH264Url: text('dash_h264_url'),
    dashAv1Url: text('dash_av1_url'),
    highlight: boolean('highlight').notNull().default(false),
  },
  (t) => [index('game_media_appid_idx').on(t.appid, t.kind, t.position)],
)

export const genre = pgTable('genre', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
})

export const gameGenre = pgTable(
  'game_genre',
  {
    appid: integer('appid')
      .notNull()
      .references(() => game.appid, { onDelete: 'cascade' }),
    genreId: text('genre_id')
      .notNull()
      .references(() => genre.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.appid, t.genreId] }), index('game_genre_genre_idx').on(t.genreId)],
)

export const category = pgTable('category', {
  id: integer('id').primaryKey(),
  description: text('description').notNull(),
})

export const gameCategory = pgTable(
  'game_category',
  {
    appid: integer('appid')
      .notNull()
      .references(() => game.appid, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => category.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.appid, t.categoryId] }),
    index('game_category_category_idx').on(t.categoryId),
  ],
)

// Amounts are Steam's minor-unit integers. `currency` is stored per row because cc=cz
// returns EUR, not CZK — never infer the currency from the country code.
export const price = pgTable(
  'price',
  {
    appid: integer('appid')
      .notNull()
      .references(() => game.appid, { onDelete: 'cascade' }),
    cc: text('cc').notNull(),
    currency: text('currency').notNull(),
    initialMinor: integer('initial_minor').notNull(),
    finalMinor: integer('final_minor').notNull(),
    discountPercent: smallint('discount_percent').notNull().default(0),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.appid, t.cc] }),
    index('price_discount_idx').on(t.cc, t.discountPercent),
    index('price_final_idx').on(t.cc, t.finalMinor),
  ],
)

// No foreign key on appid: price history is the only thing here Steam cannot re-serve, and it
// must outlive the game rows it describes — a re-hydration or a prune of delisted apps would
// otherwise cascade it away.
export const priceHistory = pgTable(
  'price_history',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    appid: integer('appid').notNull(),
    cc: text('cc').notNull(),
    currency: text('currency').notNull(),
    initialMinor: integer('initial_minor').notNull(),
    finalMinor: integer('final_minor').notNull(),
    discountPercent: smallint('discount_percent').notNull().default(0),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('price_history_appid_idx').on(t.appid, t.cc, t.observedAt)],
)

// Aggregates only. Review bodies and author identifiers are never fetched or stored —
// they are personal data we have no way to expire when a user deletes their review.
export const reviewSummary = pgTable('review_summary', {
  appid: integer('appid')
    .primaryKey()
    .references(() => game.appid, { onDelete: 'cascade' }),
  reviewScore: smallint('review_score'),
  reviewScoreDesc: text('review_score_desc'),
  totalPositive: integer('total_positive'),
  totalNegative: integer('total_negative'),
  totalReviews: integer('total_reviews'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
})

export const libraryEntry = pgTable(
  'library_entry',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    appid: integer('appid').notNull(),
    status: libraryStatus('status').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    priceSeenMinor: integer('price_seen_minor'),
    priceSeenCurrency: text('price_seen_currency'),
  },
  (t) => [
    uniqueIndex('library_entry_user_app_idx').on(t.userId, t.appid),
    index('library_entry_status_idx').on(t.userId, t.status),
  ],
)

export const libraryStatusEvent = pgTable(
  'library_status_event',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    entryId: text('entry_id')
      .notNull()
      .references(() => libraryEntry.id, { onDelete: 'cascade' }),
    status: libraryStatus('status').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('library_status_event_entry_idx').on(t.entryId, t.at)],
)
