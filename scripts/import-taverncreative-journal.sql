-- ============================================================================
-- TavernCreative journal migration into Spotlight
--
-- Moves the 8 posts currently served from files in the TC52 repo
-- (2 hardcoded block-body posts + 6 markdown files) into Spotlight's posts
-- table, under their EXISTING slugs. taverncreative.com/journal/<slug> keeps
-- working for every one of them, so no redirect is needed anywhere.
--
-- NOT A MIGRATION, and deliberately not in supabase/migrations/. This imports
-- DATA, not schema. A migration is replayed by db:reset against a fresh local
-- database, which would re-import one client's eight production blog posts into
-- every developer's local stack. It is also not recorded in
-- supabase_migrations.schema_migrations, so check-migrations.mjs neither expects
-- nor misses it.
--
-- HOW TO RUN. psql over PROD_DB_URL, not the Supabase Dashboard SQL editor:
--
--   psql "$PROD_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
--     -f scripts/import-taverncreative-journal.sql
--
-- The editor does not honour begin/commit (0073 hit this), so a statement that
-- fails part-way leaves the earlier ones applied with no rollback and no error
-- that looks like one. --single-transaction plus ON_ERROR_STOP makes the whole
-- import atomic: all 8 posts land, or none do.
--
-- Confirm PROD_DB_URL points at SPOTLIGHT (xoxvwyzvsbvbcugzsecb), not TC52.
--
-- Idempotent: posts has unique (client_id, slug), and the on-conflict clause
-- updates rather than erroring, so a re-run is safe.
--
-- Featured images were uploaded to post-images/cfa63728-a366-4b38-a307-5c2ce12643c0/
-- ahead of this migration and are byte-identical to the webp files the site
-- serves today, so every post's OG card is preserved exactly.
--
-- FAQPage entries in `schemas` were extracted from each post's markdown with
-- the site's own extractFaqPairs parser, so the FAQ JSON-LD those 4 posts emit
-- today is reproduced rather than re-authored.
-- ============================================================================

insert into public.posts (
  client_id,
  title,
  slug,
  meta_title,
  meta_description,
  excerpt,
  body,
  featured_image,
  featured_image_alt,
  status,
  published_at,
  schemas
)
values
  -- 2026-06-22-wedding-menu-card-wording.md
  (
    'cfa63728-a366-4b38-a307-5c2ce12643c0'::uuid,
    'Menu Card Wording for Plated, Family Style and Buffet Receptions',
    'wedding-menu-card-wording',
    'Wedding Menu Card Wording Guide | Tavern Creative',
    'How to word wedding menu cards for plated, family style and buffet receptions — with layout tips and dietary guidance from a Kent stationery studio.',
    'Menu cards do more than list dishes — how you word them sets the tone for the entire reception, from relaxed country supper to formal seated dinner.',
    '# Menu Card Wording for Plated, Family Style and Buffet Receptions

Menu cards are the piece of on-the-day stationery guests read while the room fills and the nerves settle — which means the words on them are doing quiet, important work. The format of your reception shapes everything about how those words should read, and what plated-dinner wording demands is quite different from what works on a buffet card or a family-sharing spread.

This guide covers each service style in turn, then tackles the question most couples leave until the last fortnight: dietary information.

## What Should a Wedding Menu Card Actually Include?

The baseline is always the same. A menu card should give guests the name of each course, enough description to know what they are eating, and any relevant allergen or dietary shorthand. Everything else is editorial choice — and editorial choice is where tone comes in.

For a formal seated dinner, that means precise, considered language. For a relaxed barn reception with sharing boards, it means something looser and warmer. The card does not need to echo the ceremony''s register exactly, but it should feel like it belongs to the same wedding.

A typical plated card structure looks like this:

**Starters**
Pan-seared scallops, cauliflower purée, crispy capers, brown butter

**Main**
Slow-roast lamb shoulder, dauphinoise, wilted greens, rosemary jus
— or —
Roasted beetroot and walnut tart, whipped goat''s cheese, dressed leaves *(v)*

**Dessert**
Dark chocolate fondant, salted caramel, vanilla cream

Note the rhythm: ingredient lists read better without fussy punctuation, and three to five components per dish is enough. Beyond that, the text starts to feel more like a recipe than a menu.

## Wording for Family Style and Sharing Menus

Family-style service — large platters at the table for guests to help themselves — is increasingly common at barn weddings, garden receptions and anything with a deliberately social feel. The language here should reflect the abundance and informality of the format.

Rather than listing "starter," "main," and "dessert" as distinct headings, many couples use section titles that suit the vibe: "To begin," "From the kitchen," "To share," "Something sweet." These feel less institutional and work especially well on our [minimalist stationery designs](/products?style=minimalist), where white space is doing as much work as the type.

A sharing menu card might read:

**To begin**
Sourdough, cultured butter, olive oil

**To share**
Slow-cooked pork belly, fennel salsa verde
Roasted aubergine with harissa and pomegranate *(vg)*
Heritage tomato salad, burrata, basil oil
Crispy new potatoes, aioli

**Something sweet**
Summer berry Eton mess
Salted dark chocolate tart *(gf)*

This approach also means you can skip per-person cards entirely and print one or two larger table cards instead — a format that works beautifully on A4 or A5 stock and costs less per table than individual place settings.

## How Do You Handle Dietary Requirements on a Menu Card?

This is the question that fills inboxes in the weeks before print. The short answer: keep shorthand visible but unobtrusive.

The most commonly used markers in the UK are *(v)* for vegetarian, *(vg)* for vegan and *(gf)* for gluten-free. Some couples add *(df)* for dairy-free. These sit neatly in brackets after the dish name and read at a glance without disrupting the flow of the list.

What you do not need to do is print a full allergen breakdown on the card itself. In the UK, Natasha''s Law covers businesses providing food — it does not require wedding hosts to label every dish. Your caterer carries the legal allergen responsibility; the menu card''s job is to help guests with common dietary preferences make easy choices, not to replace the chef''s allergen sheet.

A short note at the base of the card handles anything more complex:

*Please speak to a member of the catering team if you have a specific allergen concern.*

That single line covers the gap clearly and keeps the card clean.

For plated weddings where guests pre-selected their meal, the menu card should still list all options — not just the individual guest''s choice. People are curious about what others ordered, and it avoids any awkwardness at the table when dishes arrive.

## Buffet Menu Cards: A Different Problem Entirely

Buffet receptions need a different approach because guests are making choices in motion, not reading seated. The card functions more like signage than personal stationery. Clarity wins over elegance.

Consider a landscape-format card for each station, with a larger typeface and clear section headers. Individual tent cards work well on a long table: one per dish, with the dish name and dietary marker in large, readable type. The aesthetic can still be beautiful — printed on Fedrigoni Old Mill 300gsm, even a straightforward tent card has weight and presence — but legibility at standing distance is the priority.

If you want a unified menu card guests can take to their seats (as a keepsake or just for reference), list the buffet sections exactly as they appear on the table. Guests use it to plan a plate before they join the queue.

## Should the Menu Card Include a Welcome Note?

Sometimes. For intimate weddings of 30 or fewer guests, a short welcome line at the top of the card adds warmth — "We''re so glad you''re here" or simply the couple''s names and the date above the menu. For larger receptions, this risks feeling impersonal, and the real estate is better used on the food.

Where a welcome note works best is on a dual-purpose card that doubles as a place card. The guest''s name sits at the top, a one-line welcome follows, and the menu runs below. It is the kind of card that tends to get kept. Our full range of [on-the-day stationery](/category/on-the-day) includes exactly this format — the place card and menu combined in a single printed piece.

## Frequently Asked Questions

**Do all guests need their own menu card?**
For plated receptions, one per place setting is standard. For family-style or buffet formats, one or two per table is usually sufficient — and often more practical, since guests will lean across to share it.

**How late can we finalise the menu wording?**
With 3–5 working day dispatch from Kent plus tracked delivery on top, most couples can safely finalise wording up to two weeks before the wedding. Allow time for a proof review, which typically takes 24 hours. We recommend locking the menu with your caterer at least three weeks out so nothing is rushed.

**What size are wedding menu cards?**
A5 (148 × 210mm) is the most common format for seated dinners. For sharing or buffet cards, A4 works well, as does a tall, narrow DL format. Tent cards for buffet stations are usually landscape A6 or A5 folded.

**Should the menu card match the invitations?**
It does not have to, but a considered link — a shared typeface, colour or motif — makes the whole suite feel intentional. Couples who ordered through our [full collections](/collections) often find the coordination is already built in.

---

The menu card tends to be one of the last pieces couples finalise, which means it often gets rushed. It deserves a little more attention than that — not because it is complicated, but because guests spend longer reading it than almost any other printed item on the table. Getting the tone right, handling dietary shorthand cleanly, and matching the format to the service style takes an hour at most. The result is a card that feels considered rather than assembled. When you are ready to see the menu card alongside the rest of your on-the-day pieces, our on-the-day collection is a useful place to start.',
    'https://xoxvwyzvsbvbcugzsecb.supabase.co/storage/v1/object/public/post-images/cfa63728-a366-4b38-a307-5c2ce12643c0/journal-hero-on-the-day.webp',
    'Tavern Creative on the day wedding stationery',
    'published',
    timestamptz '2026-06-22 12:00:00+00',
    '[{"type":"FAQPage","data":{"questions":[{"question":"Do all guests need their own menu card?","answer":"For plated receptions, one per place setting is standard. For family-style or buffet formats, one or two per table is usually sufficient — and often more practical, since guests will lean across to share it."},{"question":"How late can we finalise the menu wording?","answer":"With 3–5 working day dispatch from Kent plus tracked delivery on top, most couples can safely finalise wording up to two weeks before the wedding. Allow time for a proof review, which typically takes 24 hours. We recommend locking the menu with your caterer at least three weeks out so nothing is rushed."},{"question":"What size are wedding menu cards?","answer":"A5 (148 × 210mm) is the most common format for seated dinners. For sharing or buffet cards, A4 works well, as does a tall, narrow DL format. Tent cards for buffet stations are usually landscape A6 or A5 folded."},{"question":"Should the menu card match the invitations?","answer":"It does not have to, but a considered link — a shared typeface, colour or motif — makes the whole suite feel intentional. Couples who ordered through our full collections often find the coordination is already built in."}]}}]'::jsonb
  ),
  -- 2026-06-15-why-we-print-on-fedrigoni.md
  (
    'cfa63728-a366-4b38-a307-5c2ce12643c0'::uuid,
    'Inside the Studio: Why We Print on 300gsm Fedrigoni Old Mill',
    'why-we-print-on-fedrigoni',
    'Why We Print on Fedrigoni Old Mill | Tavern Creative',
    'Discover why Tavern Creative prints wedding invitations on 300gsm Fedrigoni Old Mill — the paper quality, texture and finish that sets stationery apart.',
    'The paper a wedding invitation is printed on tells guests something before they read a single word — here''s why we chose Fedrigoni Old Mill and never looked back.',
    '# Inside the Studio: Why We Print on 300gsm Fedrigoni Old Mill

Paper makes an argument before language does. A wedding invitation arrives in the post and the guest holds it — registers the weight, feels the surface, notices whether it bends limply or holds its form. All of that happens before the envelope is opened. The choice of stock is not a background decision; it is part of the design.

At Tavern Creative, we print on 300gsm Fedrigoni Old Mill. That is not an accident or a default setting. It is the result of testing a lot of paper and landing on one that does everything we need it to do — for ink, for feel, for longevity, and for the impression it leaves with the person receiving it.

## What Fedrigoni Old Mill Actually Is

Fedrigoni is an Italian paper manufacturer with roots stretching back to the late nineteenth century. Old Mill is one of their heritage ranges: a natural white, uncoated board with a gently textured, laid surface. The grain runs in fine, regular lines across the sheet — a product of the cylinder-mould process the range is named after. It is not a smooth, clinical paper. It has character without being rustic.

The weight we use is 300gsm. For context, standard office paper runs at 80gsm. A typical magazine cover is 250–300gsm. At 300gsm, an invitation card sits in the hand with real presence. It does not flop. It does not curl at the edges once printed. It survives being propped on a mantelpiece for months without warping.

Old Mill is also FSC certified, which matters to us. The FSC mark means the wood fibre in the paper comes from responsibly managed forests. It is a small thing relative to the total environmental footprint of a wedding, but it is the right call and one we are glad to make. You can read more about how the studio approaches materials and sourcing on our [about page](/about).

## How the Paper Performs Under Print

An uncoated paper like Old Mill absorbs ink differently from a coated or gloss stock. The surface is slightly open, which means ink sits *into* the paper rather than sitting on top of it. The visual result is a matte, soft-edged quality that suits wedding stationery well. Colours read as warm rather than harsh. Black type has depth without looking aggressive.

Where it gets interesting is with hand-drawn venue illustrations. When we produce a fine-line sketch of a couple''s ceremony venue — hand-drawn by our artist and printed onto the invitation or order of service — the texture of Old Mill gives the lines a slight softness that makes them feel genuinely hand-produced rather than digitally reproduced. The paper reinforces the illustration''s character rather than flattening it.

This matters practically too. Some papers produce a moiré effect with fine-line artwork, or create banding in gradient washes. Old Mill, because of its texture and its behaviour under inkjet and laser processes, handles both with consistency. What you approve in the digital proof is, with very few exceptions, what you receive in the post.

## Does the Paper Choice Affect How Invitations Age?

It does, and more than most people realise when they are ordering. A premium wedding invitation paper is not just for the day of posting. Many couples keep their stationery — the invitation suite, the order of service, sometimes a menu card — as a physical record of the wedding. The question is whether those pieces will still look good in ten or twenty years.

Uncoated board like Fedrigoni Old Mill ages well when stored away from direct sunlight. The natural white of the paper will mellow very slightly over years, but because it begins from a warm, natural base rather than an optically brightened white, it does so gracefully. Heavily coated stocks, by contrast, can crack or peel along folds with age. Old Mill does not have a surface layer to compromise.

There is also the question of how the paper handles before your wedding. Invitations get assembled, stuffed, stamped, and posted. Some will be opened carefully; others will not. A 300gsm card does not show handling in the way a lighter stock does. Fingerprints, minor bending from the post, the impression of a pen on the envelope — these leave far less trace on a heavier, textured paper than on something thin.

## Why Not Just Use Any 300gsm Stock?

This is a fair question. Paper at 300gsm is not rare; plenty of it exists. The reason we specify Fedrigoni Old Mill rather than sourcing whatever 300gsm board is available is consistency and character in combination.

Consistency first. We print in Kent with a trusted print team we work with closely, which means the whole process is held to one standard. But consistency also requires that the paper behaves the same way week after week, order after order. Fedrigoni''s manufacturing quality control means Old Mill does not vary meaningfully between batches. Colours mix the same. The surface absorbs ink the same. That reliability feeds directly into the accuracy of the proofing process we offer every customer.

Character second. Not all 300gsm stock has a surface worth noticing. Some boards are smooth and plasticky; some are flat white and cold. Old Mill has warmth in its base tone and texture in its surface, both of which complement the design styles our studio works across — from our watercolour collections through to the clean lines of modern minimalist suites. A paper that is too neutral can make even excellent design feel generic. Old Mill gives each design a physical home that feels considered.

If you are browsing our [wedding invitation collections](/category/invitation), you will receive every design printed on Old Mill as standard. There is no upgrade tier, no premium paper option to select. It is simply what every order is printed on.

## Frequently Asked Questions

**Can I order a sample before I commit?**
Yes. The studio offers paper and print samples so you can hold the stock before placing your order. We would always recommend this if you are deciding between suites — there is no substitute for picking up the paper yourself.

**Does the 300gsm weight affect postage costs?**
It can. Heavier paper adds grams, and a fully assembled invitation suite — card, envelope, RSVP card, details insert — may push into a large letter or small parcel category with Royal Mail. We recommend weighing a complete assembled invitation before buying stamps in bulk. Our FAQ covers postage guidance in more detail.

**Is the paper suitable for addresses printed by a calligrapher?**
Old Mill''s uncoated surface takes calligraphy ink well. Most calligraphers working with dip pen and ink prefer an uncoated stock for exactly this reason — the slight texture provides a small amount of resistance that helps control the nib. Smooth, coated papers are often less reliable for this.

**What happens if I need more invitations after the original order?**
Because we use the same trusted print team and the same stock, reorders are straightforward. You can reorder through the same personalisation tool, approve the same proof, and the paper will match. Dispatch is within 3–5 working days of proof approval.

---

The details that make stationery feel right are often the ones guests cannot name. They register weight, finish, the way colour sits on a surface — and they draw a conclusion about care and quality without ever articulating why. Fedrigoni Old Mill is the material reason Tavern''s work holds together the way it does. If you want to explore what that looks like across the full product range, the best place to start is the [complete collection](/products).',
    'https://xoxvwyzvsbvbcugzsecb.supabase.co/storage/v1/object/public/post-images/cfa63728-a366-4b38-a307-5c2ce12643c0/journal-hero-invitation.webp',
    'Tavern Creative wedding invitations',
    'published',
    timestamptz '2026-06-15 12:00:00+00',
    '[]'::jsonb
  ),
  -- 2026-06-08-table-plan-etiquette.md
  (
    'cfa63728-a366-4b38-a307-5c2ce12643c0'::uuid,
    'Table Plan Etiquette: Seating Difficult Guests Without Causing Offence',
    'table-plan-etiquette',
    'Wedding Table Plan Etiquette | Tavern Creative',
    'How to seat tricky guests, handle divorced parents and split families without causing offence. Calm, practical table plan advice from a Kent studio.',
    'The table plan is the most politically charged piece of stationery you will produce — here is how to approach it without losing your mind.',
    '# Table Plan Etiquette: Seating Difficult Guests Without Causing Offence

The table plan is the piece of stationery guests will scrutinise most carefully on the day itself — and the one most likely to cause a quiet, simmering conversation on the drive home. Getting it right is less about following rigid rules and more about understanding the relationships in the room. What follows is a practical framework for seating people who would rather not be near each other, without the arrangement feeling like a snub to anyone.

## Start With the Structure, Not the Names

Before you place a single guest, decide on the layout of your room. The number of tables, their shape — rounds of eight, long feasts of twelve, a mix — determines how much flexibility you actually have. A round of eight seats is harder to subdivide diplomatically than a long table, where you can quietly put two metres of polite strangers between two people who have history.

Once you have your table shapes confirmed, group your guests into broad social clusters first: family, close friends, work colleagues, university crowd, school friends, neighbours. This sounds obvious, but couples who jump straight into named-placement often end up shuffling everyone around for hours because they began at the wrong level of detail. Sketch your clusters before you assign names to seats.

Your top table or head table is its own conversation. The traditional format — couple flanked by both sets of parents, then best man and maid of honour — assumes an uncomplicated family structure. Increasingly, it doesn''t reflect reality.

## How to Handle Divorced or Separated Parents

Divorced parents at the head table is one of the most common questions we encounter. The short answer: they do not have to share the top table at all. Several alternatives work well.

The **sweetheart table** — just the two of you, perhaps flanked by your wedding party — removes the problem entirely. Your parents each become guests of honour at their own table, surrounded by their own friends, which most of them will quietly prefer.

If you do want a traditional top table, the accepted modern convention is to seat each parent with their current partner or spouse, treating them as distinct units. The table typically reads: stepparent or partner, parent, you, your partner, their parent, their stepparent or partner. Step-parents on the outside, biological parents closer to the centre. This arrangement acknowledges both relationships without forcing proximity between people who have moved on.

If a parent is attending without a partner, seat them with people they know well and genuinely enjoy. Being isolated at the edge of a top table because their ex has a new partner is not a kindness — give them a table where they will feel at ease.

## What to Do When Families Simply Do Not Get On

Feuding relatives, the family friend who said something unforgivable three Christmases ago, cousins who stopped speaking after a disputed will — weddings surface all of it. The guiding principle is distance and distraction, in that order.

Physical distance across a room reduces the chance of an accidental confrontation. If your venue has a long room or a layout with distinct sections, use it. Seat people who have history at opposite ends, not just on different tables in the same half of the room.

Distraction means giving each difficult guest a table full of people they actively like. A person who is enjoying themselves does not go looking for trouble. Seat your outspoken uncle next to the friends who find him funny. Seat the ex-partner who remained in your social circle at a table with the mutual friends who genuinely want to catch up with them, not at a stiff mixed table where they will feel observed.

Avoid the instinct to create a dedicated "difficult people" table. You know the one — the collection of guests who don''t fit neatly anywhere else. They will sense it immediately, and it tends to produce either awkward silence or, depending on the mix, a combustible combination of people with nothing in common except being overlooked.

## Does Everyone Need an Assigned Seat?

For a seated meal, yes. Unassigned seating at a formal dinner creates a slow, anxious shuffle as guests work out where they belong, and invariably leaves the last few arrivals — often the ones who travelled furthest — with the least desirable positions. The table plan does not feel like control; it feels like hospitality.

For a more relaxed format — a standing reception, a buffet, or a wedding breakfast with just a few tables — you can assign tables without assigned seats, which gives you the structural benefits without the granular complexity. Our [on-the-day stationery collection](/category/on-the-day) includes table plan formats for both approaches, so the design can match the mood of your reception.

If you have guests with mobility requirements or hearing difficulties, assigned seating becomes even more important. Position those guests nearer to the exit, away from the band or speakers, and at a table with easy access from the service side.

## Should You Tell Guests Why They''ve Been Seated Somewhere?

No. The moment you start explaining the rationale behind your table plan, you confirm that it was a loaded decision. Most guests will accept the seating gracefully and get on with the evening. If someone does ask, a calm "we tried to make sure everyone was with people they know" closes the conversation without inviting debate.

The one exception: if you know a guest has a specific concern — a new parent who needs to be near a quiet exit, a guest with dietary needs who should be close to the waitstaff flow — a brief, private word from you or your partner before the meal begins is genuinely considerate.

## Frequently Asked Questions

**How far in advance should I finalise the table plan?**
Most venues ask for final numbers and a table plan 7–14 days before the wedding. Build in a week before that deadline to account for last-minute RSVP changes or cancellations. Finalising three to four weeks out is ideal; it gives you time to adjust without the pressure of the week before.

**Can partners sit next to each other at a round table?**
Traditionally, couples were separated to encourage conversation. In practice, most modern couples prefer to seat partners together, particularly where guests come from different social groups and may not know many people. Either is correct. Do what makes your guests comfortable.

**What if a guest RSVPs late after the plan is printed?**
Print a small number of supplementary place cards rather than reprinting the whole plan. A neat handwritten addition to the plan itself is also perfectly acceptable — guests understand that logistics shift. If you want to avoid this, check our [FAQ page](/faq) for advice on RSVP wording that encourages responses by the requested date.

**Do children need their own seats on the plan?**
Yes, if they are attending the meal. Most families prefer children seated with their parents rather than at a dedicated children''s table, unless the children know each other and the parents specifically request it.

**Is it rude to seat a single guest at a table with all couples?**
It can feel isolating. Where possible, group solo guests together, or with friends who will include them naturally. A single guest at a table of four couples will often leave early.

---

The table plan that causes least upset is usually the one built around genuine knowledge of the people in the room — not diplomatic guesswork or rigid tradition. If you are still working through your on-the-day stationery as a whole, browsing our [collections](/collections) is a useful way to see how the table plan sits within the wider suite of menus, place cards, and orders of service, all printed on 300gsm Fedrigoni Old Mill and dispatched within 3–5 working days once your proof is approved.',
    'https://xoxvwyzvsbvbcugzsecb.supabase.co/storage/v1/object/public/post-images/cfa63728-a366-4b38-a307-5c2ce12643c0/journal-hero-on-the-day.webp',
    'Tavern Creative on the day wedding stationery',
    'published',
    timestamptz '2026-06-08 12:00:00+00',
    '[{"type":"FAQPage","data":{"questions":[{"question":"How far in advance should I finalise the table plan?","answer":"Most venues ask for final numbers and a table plan 7–14 days before the wedding. Build in a week before that deadline to account for last-minute RSVP changes or cancellations. Finalising three to four weeks out is ideal; it gives you time to adjust without the pressure of the week before."},{"question":"Can partners sit next to each other at a round table?","answer":"Traditionally, couples were separated to encourage conversation. In practice, most modern couples prefer to seat partners together, particularly where guests come from different social groups and may not know many people. Either is correct. Do what makes your guests comfortable."},{"question":"What if a guest RSVPs late after the plan is printed?","answer":"Print a small number of supplementary place cards rather than reprinting the whole plan. A neat handwritten addition to the plan itself is also perfectly acceptable — guests understand that logistics shift. If you want to avoid this, check our FAQ page for advice on RSVP wording that encourages responses by the requested date."},{"question":"Do children need their own seats on the plan?","answer":"Yes, if they are attending the meal. Most families prefer children seated with their parents rather than at a dedicated children''s table, unless the children know each other and the parents specifically request it."},{"question":"Is it rude to seat a single guest at a table with all couples?","answer":"It can feel isolating. Where possible, group solo guests together, or with friends who will include them naturally. A single guest at a table of four couples will often leave early."}]}}]'::jsonb
  ),
  -- 2026-06-01-hand-drawn-venue-sketches.md
  (
    'cfa63728-a366-4b38-a307-5c2ce12643c0'::uuid,
    'Why Hand-Drawn Venue Sketches Outlast Photo-Based Stationery',
    'hand-drawn-venue-sketches',
    'Hand-Drawn Venue Sketches vs Photo Stationery | Tavern',
    'A wedding venue illustration outlasts any photograph on stationery. Here''s why hand-drawn sketches print better, age better, and mean more to guests.',
    'A hand-drawn venue illustration does something a photograph never quite can — it turns your stationery into a piece of art worth keeping.',
    '# Why Hand-Drawn Venue Sketches Outlast Photo-Based Stationery

A photograph of your venue is technically accurate. A hand-drawn wedding venue illustration is something more considered — it decides what matters, removes what doesn''t, and renders the building in a form that will print crisply at any scale, on any paper, without ever looking dated.

That distinction might sound minor when you are in the thick of planning and every decision feels equally urgent. It isn''t minor. The choice between a photograph and an illustration shapes how your stationery looks on the day, how well it reproduces, and — more than couples usually anticipate — how long guests hold on to it afterwards.

## What a Venue Illustration Actually Does to a Design

Photography and illustration are solving different problems. A photograph captures; an illustration interprets. When an illustrator sits with a reference image of a barn, a country house or a coastal hotel, they are making editorial decisions at every stroke: which roofline defines the building''s character, where the shadows fall to give the structure depth, which details — a wrought-iron gate, a particular window arch, a clock tower — carry the identity of the place.

The result is an image that reads as a composition rather than a record. On stationery, that matters. Paper is not a screen. The tonal range of even the finest printing is narrower than what a camera captures, which is why photographs on print often look flatter or murkier than the original image suggests they will. A fine-line pen illustration, by contrast, is already designed for print. The linework holds at every size, from a 90×55mm save-the-date to an A4 order of service cover. The contrast is inherent to the medium.

There is also the question of colour. A photograph of a venue is, by definition, tied to the weather, the season, and the time of day it was taken. An illustration exists outside all of that. The same sketch can sit inside a dusty-rose watercolour wash for one couple and be printed in deep ink on dark card for another. It adapts to a suite rather than constraining it.

## Is a Venue Sketch Worth It for Every Type of Wedding?

The honest answer is: not every couple needs one, but most benefit from considering it. If your venue has a distinctive exterior — a grade-listed country house, a medieval barn, a converted lighthouse, a walled garden with a recognisable gate — an illustration gives guests a quiet jolt of recognition the moment they open the envelope. They know exactly where they are going, and they know you have thought about the stationery properly.

If the venue is more interior-led — a city restaurant, a modern events space — the case is slightly different. In those situations, illustrators often work from a detail rather than the full facade: an ornate door, a signature chandelier, a courtyard that guests will pass through on the day. The specificity still lands. It just asks a little more of the brief.

What a venue sketch is never worth, from a design perspective, is using it as a decorative afterthought — dropped into a template that wasn''t built to carry it. At Tavern Creative, the [venue sketch commission](/venue-sketches) is drawn specifically for the template it will inhabit, in the line weight and style that suits the rest of the suite. It isn''t a clip-art placeholder. That is what makes the difference between a sketch that elevates the design and one that sits awkwardly in the corner.

## How Illustrations Age Compared to Photographs

This is the part couples rarely think about in June, when they are focused entirely on the wedding itself. But stationery has a longer life than the event it announces.

Guests keep orders of service. They tuck them into drawers, frame them occasionally, and — more often than you might expect — refer to them when they want to remember where they were that day. A photograph of a venue, printed in 2026, will start to look like a photograph from 2026. The digital file compression, the colour grading choices fashionable at the moment, the slightly over-processed sky: these are period markers. Ten years from now they will read as such.

A fine-line illustration is largely exempt from this kind of dating. The idiom of hand-drawn pen work has been in continuous use for several centuries. It does not carry the visual signature of a particular software version or camera sensor. A sketch produced this summer will not look noticeably older in 2036 than it does in 2026. That is an unusual quality in any printed artefact.

This is also why venue illustrations translate so well to the [classic venue illustration order of service](/products/classic-venue-illustration-order-of-service) format — a piece of on-the-day stationery that guests tend to hold on to precisely because it feels considered. The format has weight in the hand (our orders of service are printed on 300gsm Fedrigoni Old Mill, FSC certified) and a cover image that gives it the quality of a small printed keepsake. That is a different object from a folded sheet of paper with a ceremony running order on it.

## What to Prepare When Commissioning a Venue Sketch

The cleaner your reference material, the sharper the final illustration. Illustrators work from photographs, and the ideal reference set covers a few specific things.

A straight-on elevation of the main facade, taken in flat or overcast light, is the most useful starting point — harsh midday shadows obscure the architectural detail that makes a building recognisable. If the venue has a particularly important feature that isn''t front-facing (a tower visible from the gardens, an entrance portico approached from the side), include a reference shot of that too. A brief note on which elements matter most — "guests arrive through the stable arch, not the main door" — saves several rounds of revision.

Turnaround time for a venue commission at Tavern Creative runs alongside the broader proof-and-dispatch timeline: once the illustration is approved, production moves to 3–5 working day dispatch. Building in two to three weeks between placing your order and your latest acceptable delivery date is sensible, particularly if you are ordering during the summer peak when commissions are busiest.

## Bringing It Together Across the Suite

One of the strongest arguments for a venue illustration is its flexibility across multiple pieces. The same sketch, commissioned once, can run on your invitations, on the order of service cover, on the table plan header, and on your thank you cards — creating a visual thread through the entire suite that no photograph could sustain at different print sizes and orientations.

That coherence is worth planning for early. If you know you want the illustration to run across several pieces, mention it when you place the order. The composition of the sketch can be centred or asymmetric depending on how it needs to sit in different layouts.

Browse the full range of stationery styles in our [collections](/collections) to see how the venue sketch integrates across different design directions — from spare and modern to layered watercolour. The illustration adapts to the design rather than the other way around, which is rather the point.

A well-made sketch is not an add-on. It is the detail that makes guests turn the stationery over and look at it twice — and then, often enough, decide to keep it.',
    'https://xoxvwyzvsbvbcugzsecb.supabase.co/storage/v1/object/public/post-images/cfa63728-a366-4b38-a307-5c2ce12643c0/journal-hero-on-the-day.webp',
    'Tavern Creative on the day wedding stationery',
    'published',
    timestamptz '2026-06-01 12:00:00+00',
    '[]'::jsonb
  ),
  -- 2026-05-25-six-week-stationery-countdown.md
  (
    'cfa63728-a366-4b38-a307-5c2ce12643c0'::uuid,
    'The Six-Week Wedding Stationery Countdown (What to Order, When)',
    'six-week-stationery-countdown',
    'Six-Week Wedding Stationery Timeline | Tavern Creative',
    'Inside six weeks to your wedding? Here''s exactly what stationery to order and when, from on-the-day pieces to thank you cards. Calm, clear, achievable.',
    'Six weeks sounds like plenty of time. Then you remember the menus still need a final dish from the caterer, you haven''t decided on place card formats, and someone just…',
    '# The Six-Week Wedding Stationery Countdown (What to Order, When)

Six weeks sounds like plenty of time. Then you remember the menus still need a final dish from the caterer, you haven''t decided on place card formats, and someone just added a dietary requirement. The good news: a clear week-by-week order takes most of the pressure out of this stretch. Here is exactly what to tackle, and when.

---

## Why the Final Six Weeks Are the Most Stationery-Dense Part of Planning

Your invitations went out months ago. RSVP replies have (mostly) come back. What remains is the entire on-the-day suite — and this is where couples consistently underestimate the workload.

The on-the-day layer typically includes: orders of service, menus, place cards, a table plan, welcome signage, and any directional signs for a venue that needs them. Each piece requires finalised information, a proof review, and time to print and dispatch. None of them can be ordered speculatively; they all depend on confirmed guest counts, confirmed dishes, and confirmed logistics.

That is why the timeline below works backwards from your wedding date and treats certainty as the unlocking condition at each stage.

---

## The Week-by-Week Breakdown

### Six weeks out — lock the guest list and seat the room

Before a single stationery order can be placed, you need two things: a final guest number and a table plan you are willing to commit to (provisionally, at least). You will not have absolute certainty yet, but you need a working figure for quantities.

This week: confirm your expected attendance with your venue. Calculate quantities with a ten-per-cent buffer on consumables like menus and orders of service — a handful extra costs very little, running short costs considerably more on a rush reprint.

If you are commissioning a hand-drawn venue illustration for your order of service or menus, this is also the moment to get that brief in. At Tavern Creative, venue sketches are created in the studio and included free with any venue-sketch template order, but they do need a little lead time to get right. Starting at six weeks is comfortable.

### Five weeks out — order orders of service

Orders of service are the piece that causes the most last-minute panic, and they shouldn''t. The content — ceremony structure, names of readings, any music details — is usually knowable by week five even if minor elements shift later.

Place your order of service now. Once you have approved the digital proof, printing on 300gsm Fedrigoni Old Mill and dispatch from Kent takes 3–5 working days, so the urgency is genuinely low if you are organised. What eats time is the revision loop: couples who start at two weeks out often spend as much time chasing sign-off from officiants as they do on the stationery itself. Start early, finish calmly.

Browse the [on-the-day stationery collection](/category/on-the-day) to see the full range of ceremony and reception pieces alongside sample wording structures.

### Four weeks out — menus and welcome signage

Menus require confirmed dishes from your caterer, which is a dependency outside your control. Chase that confirmation at the five-week mark so you are ready to order at four.

Welcome signage — a freestanding board or framed print with the couple''s names and date — has almost no variable content and can technically be ordered any time after your date is set. Most couples forget about it until late, then treat it as urgent. Do it at four weeks and you will never think about it again.

A note on quantities for menus: one per place setting is the standard, but check with your venue. Some prefer one per couple; others use them as table centrepieces and want fewer. Clarify before you order.

### Three weeks out — place cards and table plan

Place cards and table plans are the last pieces to order because they depend on a settled seating arrangement. By three weeks out, you should have received the overwhelming majority of RSVPs and made final table assignments.

Order both together. The table plan in particular benefits from being designed with the final layout in mind — a proof that has been retrofitted to accommodate late additions rarely looks as considered as one designed with the complete list from the start.

If you are still chasing a handful of RSVPs at three weeks, make a decision on their behalf. Hold two seats, order to that number, and adjust nothing. Chasing RSVPs beyond three weeks out absorbs energy that is better spent elsewhere. (The [FAQ page](/faq) has advice on RSVP wording and how to handle non-responders if you are at that stage.)

### Two weeks out — review, check, hold your nerve

Two weeks out, every stationery order should be placed or already in your hands. This week is for checking. Do a quiet count: orders of service against expected ceremony attendance, menus against your catering numbers, place cards against your finalised seating chart.

If something is wrong — a misspelling, a number that doesn''t add up, a dish that changed — this is your last comfortable window to reorder without any pressure. Tavern''s 3–5 working day dispatch means a reorder placed early in the week is usually back with you within the following week.

Do not leave this check until the week of the wedding.

### One week out — pack and label

This is a logistics week, not an ordering week. Gather everything into one place. Pack orders of service together, menus together, place cards in alphabetical order or pre-sorted by table — whichever is easier for your venue team to work with on the morning.

Label everything clearly with quantities and destinations. Your venue coordinator will love you for it, and you will love yourself for it at 7 a.m. on the morning of the wedding.

---

## What About Thank You Cards — When Should Those Be Ordered?

Thank you cards sit outside this six-week window but deserve an honourable mention here because the time to order them is now, before you are deep in post-wedding exhaustion.

The convention in the UK is to send thank you cards within three months of the wedding, but most couples aim for six to eight weeks. If you design and order them before the wedding — using an image from your engagement shoot, or simply a clean typographic design with your names — you remove one task from the post-wedding to-do list entirely.

The [thank you card collection](/category/thank-you) includes options that can be personalised and proofed ahead of time, then dispatched whenever you are ready. It is a small act of future-self kindness worth doing right now.

---

## Frequently Asked Questions

**How far in advance should I order wedding stationery for the day itself?**
For on-the-day pieces — menus, orders of service, place cards, and table plans — four to six weeks is the comfortable window. Some pieces, like orders of service with venue illustrations, benefit from being started earlier. Others, like place cards, genuinely cannot be finalised until your guest list is confirmed.

**What if I have a late RSVP after I''ve already ordered place cards?**
Order a small overage when you place the original order — five to ten extras is usually sufficient. A single name on a plain place card can be hand-written beautifully and most guests will never know the difference. Alternatively, Tavern''s 3–5 working day dispatch means a small reorder is rarely a crisis.

**Do I need stationery for every part of the reception?**
No. Prioritise by the impact each piece makes. An order of service is almost always worth doing; directional signage matters most at larger or multi-site venues; individual menus are lovely but not essential if your caterer provides table menus. Design to your budget and your venue, not against a checklist.

---

The six-week window is tight only when stationery is treated as an afterthought. Work the weeks in order — guest numbers first, then each piece as its information becomes available — and the whole suite comes together without the rush. Everything you need for the reception is in the on-the-day collection, designed to be personalised in the browser, proofed within hours, and on its way to you within three working days of approval.',
    'https://xoxvwyzvsbvbcugzsecb.supabase.co/storage/v1/object/public/post-images/cfa63728-a366-4b38-a307-5c2ce12643c0/journal-hero-on-the-day.webp',
    'Tavern Creative on the day wedding stationery',
    'published',
    timestamptz '2026-05-25 12:00:00+00',
    '[{"type":"FAQPage","data":{"questions":[{"question":"How far in advance should I order wedding stationery for the day itself?","answer":"For on-the-day pieces — menus, orders of service, place cards, and table plans — four to six weeks is the comfortable window. Some pieces, like orders of service with venue illustrations, benefit from being started earlier. Others, like place cards, genuinely cannot be finalised until your guest list is confirmed."},{"question":"What if I have a late RSVP after I''ve already ordered place cards?","answer":"Order a small overage when you place the original order — five to ten extras is usually sufficient. A single name on a plain place card can be hand-written beautifully and most guests will never know the difference. Alternatively, Tavern''s 3–5 working day dispatch means a small reorder is rarely a crisis."},{"question":"Do I need stationery for every part of the reception?","answer":"No. Prioritise by the impact each piece makes. An order of service is almost always worth doing; directional signage matters most at larger or multi-site venues; individual menus are lovely but not essential if your caterer provides table menus. Design to your budget and your venue, not against a checklist."}]}}]'::jsonb
  ),
  -- 2026-05-18-order-of-service-wording-guide.md
  (
    'cfa63728-a366-4b38-a307-5c2ce12643c0'::uuid,
    'Order of Service Wording: A Calm Guide for Couples Married This Summer',
    'order-of-service-wording-guide',
    'Order of Service Wording Guide | Tavern Creative',
    'A calm guide to order of service wording for UK weddings: what to include, how long, and the structure that works for civil, religious or humanist ceremonies.',
    'The order of service is the only piece of wedding stationery your guests read cover to cover. They follow it through the ceremony, glance back at it during the…',
    'The order of service is the only piece of wedding stationery your guests read cover to cover. They follow it through the ceremony, glance back at it during the reception, and a few will tuck it into a jacket pocket as a keepsake. So the wording does real work. This guide covers what to include, what to leave out, and how to shape the booklet for a civil, religious or humanist ceremony — written for couples whose date is 6 to 12 weeks away.

## What goes in a wedding order of service

Three blocks. The cover, the ceremony itself in running order, and a short acknowledgement at the back.

The cover carries your names, the wedding date and the venue. Many couples add a hand-drawn venue illustration here — it sets the visual tone before anyone opens the booklet, and the illustration usually carries through from the invitation suite. Inside, list every step of the ceremony in the order it happens: entrance music, words of welcome from the celebrant, readings (with the reader''s name beneath each one), hymns or songs printed in full, the vows, the ring exchange, register signing music, recessional. The back page is where you thank the people who made the day possible.

The order of service also sits alongside the rest of your [on-the-day stationery](/category/on-the-day) — menus, place cards, table plans, signage — and earns its place because, unlike the others, every guest reads it from start to finish.

Anything beyond those three blocks is optional. A "thank you for joining us" line on the back is graceful. A long story about how you met belongs on the wedding website, not on a printed leaflet that''s about to be folded into a hundred jacket pockets.

## How long should an order of service be?

For most UK weddings, four to eight pages is the right length. An A5 saddle-stitched booklet on 300gsm Fedrigoni Old Mill — the same stock we print invitations on — holds up to 12 pages without losing its hand-feel. Anything thicker reads as a programme, not a booklet.

A four-page version works for a civil ceremony with no hymns: front cover, two interior pages for the running order, back page for acknowledgements. An eight-page version covers a fuller religious ceremony with three hymns printed in full and two readings spelled out line by line.

Print one per household, then add another 15% for keepsakes — the celebrant will want a copy for their records, the photographer will shoot one for the editorial pull, and there are always last-minute family members who arrive without theirs. If you''re not sure, round up. The cost difference between 80 and 100 booklets is small; the difference between running out and not is much bigger.

For longer ceremonies (Catholic mass, full Anglican service, multi-faith ceremonies), brief your celebrant before you finalise the wording. They will have a structural template you can adapt rather than rewriting from scratch. Their version is usually 10 to 12 pages and includes the order of communion or the specific liturgy. Ask for theirs in writing so the booklet matches the words your celebrant will actually say on the day.

## Civil, religious and humanist ceremonies: where the wording differs

A civil ceremony has the lightest stationery footprint. The registrar leads a tightly-structured 25 to 35 minute event with no religious references permitted — no hymns, no prayers, no Bible readings. Your booklet covers the entrance, the registrar''s words of welcome, your two chosen readings, the declaratory and contracting words (these are statutory; the registrar will give you the exact phrasing), the ring exchange, the signing of the schedule, and the recessional. Civil orders of service run shortest, often four to six pages.

A religious ceremony adds hymns, prayers and readings from scripture. Print hymns in full so guests can sing along even without a hymnal — the line breaks and verse numbers matter for the timing. Readings from the King James Bible or the Book of Common Prayer don''t need permission to print; modern translations may. If a contemporary translation is being used, name it in small type below the reading ("New Revised Standard Version" or similar) so people who know it can follow.

A humanist or independent ceremony sits somewhere between the two. The celebrant writes a bespoke script with your input — usually more narrative, often more poetic. Your order of service should reflect the structure they''ve drafted rather than a generic civil template. If a reading is from a copyrighted poem or contemporary author, describe it rather than reproducing the full text ("A reading from Mary Oliver''s *Wild Geese*, read by [name]") — full reproduction needs the rights holder''s permission, and a clean line credit reads more elegantly than a half-page of unattributed verse.

## Thank-yous and acknowledgements: a quiet template that always works

The back page should thank, not eulogise. Two paragraphs are plenty; three is the upper limit.

Open with the people directly involved in the ceremony — bridesmaids, groomsmen, ushers, the celebrant. Name them by first and last name in a clean list rather than burying them in a paragraph. Guests scan this part to make sure their relatives have been included.

Next, a short line of thanks for the day''s hospitality — the venue, the caterers if they''re family friends, the florist or musician if they''re loved ones rather than commercial hires. Keep it to professionals you genuinely want to credit publicly. The full supplier list belongs on a wedding website.

Close with a single sentence to your guests. "Thank you for sharing today with us" is enough. Resist the urge to add a quote from a love poem here; the readings are the place for that. A clean closing line in your own voice is more memorable than borrowed sentiment.

If a parent or grandparent has died, a discreet "in loving memory of [name]" sits well beneath the acknowledgements, separated by a small ornament or a horizontal line. A single line carries more weight than a paragraph.

## Frequently asked questions

**When should we order the order of service?**

Four to six weeks before the ceremony. That gives you enough lead time to finalise readings, confirm hymns with the celebrant, and approve the proof. Our dispatch is 3 to 5 working days once you''ve approved on screen, so even five weeks out is comfortable. For longer ceremonies with multiple hymns, give yourself the full six.

**Do we need to print the readings in full?**

Hymns yes — guests sing along, so the verses need to be on the page. Readings can go either way. For shorter readings (a sonnet, a single Bible passage), print the text in full. For longer or copyrighted readings, name the piece and the reader instead. Both work; the structural clarity matters more than the verbatim text.

**Can the order of service match our invitation suite?**

Yes — and it should. The [classic venue illustration order of service](/products/classic-venue-illustration-order-of-service) uses the same hand-drawn cover artwork as the matching invitation suite, with the typography and palette carried through. If you''ve ordered invitations from a Tavern collection, the order of service almost certainly exists in the same family.

## A calm place to land

The order of service is the easiest piece in the suite to overthink and the easiest to get right with a calm structure. Names on the cover. The ceremony in order. A clean acknowledgement at the back. The booklets are folded, stitched and trimmed in Kent by our trusted print team, dispatched within 3 to 5 working days, and the design carries straight through from your [matching invitation suite](/category/invitation). Every Tavern collection runs from save the date through to thank-you card so the day reads as a single visual idea — the order of service is simply the page in the middle that your guests actually read.',
    'https://xoxvwyzvsbvbcugzsecb.supabase.co/storage/v1/object/public/post-images/cfa63728-a366-4b38-a307-5c2ce12643c0/journal-hero-on-the-day.webp',
    'Tavern Creative on the day wedding stationery',
    'published',
    timestamptz '2026-05-18 12:00:00+00',
    '[{"type":"FAQPage","data":{"questions":[{"question":"When should we order the order of service?","answer":"Four to six weeks before the ceremony. That gives you enough lead time to finalise readings, confirm hymns with the celebrant, and approve the proof. Our dispatch is 3 to 5 working days once you''ve approved on screen, so even five weeks out is comfortable. For longer ceremonies with multiple hymns, give yourself the full six."},{"question":"Do we need to print the readings in full?","answer":"Hymns yes — guests sing along, so the verses need to be on the page. Readings can go either way. For shorter readings (a sonnet, a single Bible passage), print the text in full. For longer or copyrighted readings, name the piece and the reader instead. Both work; the structural clarity matters more than the verbatim text."},{"question":"Can the order of service match our invitation suite?","answer":"Yes — and it should. The classic venue illustration order of service uses the same hand-drawn cover artwork as the matching invitation suite, with the typography and palette carried through. If you''ve ordered invitations from a Tavern collection, the order of service almost certainly exists in the same family."}]}}]'::jsonb
  ),
  -- hardcoded
  (
    'cfa63728-a366-4b38-a307-5c2ce12643c0'::uuid,
    'How many wedding invitations should you order? The rule of thumb',
    'how-many-wedding-invitations-to-order',
    null,
    'How to count invitations correctly (one per household, not per guest), the spare percentage to add for safety, and what to do when you''re between two numbers.',
    'Couples sometimes order an invitation per guest. That''s almost always too many. The correct rule is one per household — but the percentage you add on top is where most people undershoot.',
    'If you''re inviting 100 guests, you don''t need 100 invitations. You need somewhere between 50 and 60 — and getting that maths right (or wrong) is the difference between a smooth print run and a last-minute scramble to set up a small reprint.

## Count households, not guests

One invitation goes to one household. A couple at the same address counts as one invitation. A family of four counts as one invitation. A single guest with a plus-one counts as one invitation.

There''s only one exception: adult children still living at the parental home. Tradition says you send them their own invitation if they''re old enough that an envelope addressed jointly to Mr & Mrs Smith wouldn''t feel like it included them. Most couples now send one invitation per household and let the parents pass on the details — but if you''d prefer the formal treatment, send the extras.

## Add 10–15% extras

Always over-order. Standard practice is 10–15% more than your household count. Here''s what those extras cover:

- Late additions — second cousins you forgot, the new partner of a single friend, last-minute children who''d been on the maybe list.
- Replacements for any lost in the post — Royal Mail doesn''t always deliver.
- Keepsakes — one for each set of parents, one for your wedding photographer to shoot, one for your own scrapbook.
- Mistakes — handwritten names, addresses in the wrong format, the occasional envelope you''ll seal before realising you wrote on it wrong.

## Worked example: 120-guest wedding

120 guests typically equals about 65 households (a roughly even mix of couples, families and singles). Add 15% — that''s 10 extras. Round up to a clean ordering quantity. Most stationers (us included) sell in tiers of 10, so order 75. You''ll have 10 spare for keepsakes, lost-in-post, and mistakes.

## Save the dates and thank-you cards follow the same rule

If you order 75 invitations, order 75 save the dates earlier and 75 thank-you cards later. Same households, same envelopes, same maths. The only piece of stationery that scales by guest count rather than household is the on-the-day suite (place cards, menus, order of service) — those are one per guest, plus 10% for the celebrant, photographer and keepsakes.',
    'https://xoxvwyzvsbvbcugzsecb.supabase.co/storage/v1/object/public/post-images/cfa63728-a366-4b38-a307-5c2ce12643c0/journal-hero-invitation.webp',
    'Tavern Creative wedding invitations',
    'published',
    timestamptz '2026-05-08 12:00:00+00',
    '[]'::jsonb
  ),
  -- hardcoded
  (
    'cfa63728-a366-4b38-a307-5c2ce12643c0'::uuid,
    'When to send wedding save the dates: a UK timeline',
    'when-to-send-save-the-dates',
    null,
    'The traditional UK timeline for save the dates, plus when to bring it forward for destination weddings, peak-season dates and overseas family.',
    'Most couples ask the same question first: when do we send the save the dates? Here''s the short answer, the long answer, and the edge cases that move the goalposts.',
    'Save the dates are the first formal announcement of your wedding — the moment your friends and family realise the planning has gone from rings and ideas to a real date on the calendar. Get the timing right and your guest list books out the right weekend; get it wrong and you''ll be sending invitations to people who''ve already booked Glastonbury.

## The traditional UK timeline: 8–12 months out

For a typical UK wedding, post your save the dates 8 to 12 months before the day. That''s far enough out for guests to put it in the diary without it feeling too premature, and it gives them time to book holiday from work, organise childcare, and book travel and accommodation if they''re coming from any distance.

Eight months is the lower bound — fine for a low-key UK wedding where most guests are local. Twelve months is the upper bound — better for a peak-season date, a destination, or if your guest list includes a lot of overseas family.

## When to send earlier than 12 months

- Destination weddings — send 12 to 18 months ahead so guests can save and book flights.
- Peak-season dates (June, July, September) — UK venues book out fastest, and your guests will be balancing other weddings on the same weekend.
- Bank holiday weekends and Christmas — your guests have other plans too. Earlier notice gives them time to choose yours.
- Overseas family — visas, flights and accommodation all take longer to organise. 12 months minimum.

## What goes on a save the date

Five things, in this order: your names, the wedding date, the city or region (or full venue if you''ve confirmed it), the phrase "invitation to follow", and an optional wedding website link if you have one. That''s it. RSVP deadlines, dress code and accommodation details belong on the full invitation, which follows 4–6 months later.

## What to do if you''re behind

If you''re less than 8 months out, skip the save the date entirely and send the full invitation a little earlier — say, 5 months out instead of 4. The save the date is a courtesy, not a requirement; the invitation is the document that needs to land in time for the RSVP deadline.

And if you''re more than 12 months out and worried? Don''t be. Send anyway. Better that your wedding sits in the diary alongside their next holiday than gets squeezed out by a stag do they booked last month.',
    'https://xoxvwyzvsbvbcugzsecb.supabase.co/storage/v1/object/public/post-images/cfa63728-a366-4b38-a307-5c2ce12643c0/journal-hero-save-the-date.webp',
    'Tavern Creative save the date cards',
    'published',
    timestamptz '2026-05-01 12:00:00+00',
    '[]'::jsonb
  )
on conflict (client_id, slug) do update set
  title              = excluded.title,
  meta_title         = excluded.meta_title,
  meta_description   = excluded.meta_description,
  excerpt            = excluded.excerpt,
  body               = excluded.body,
  featured_image     = excluded.featured_image,
  featured_image_alt = excluded.featured_image_alt,
  status             = excluded.status,
  published_at       = excluded.published_at,
  schemas            = excluded.schemas;


-- ============================================================================
-- VERIFICATION -- expect 9 rows: the 8 migrated below plus the
-- evening-wedding-invitation-wording post Spotlight already held.
-- Every row must show published, a non-null hero, and a body length > 0.
-- ============================================================================

select
  p.slug,
  p.status,
  p.published_at::date            as published,
  length(p.body)                  as body_chars,
  p.featured_image is not null    as has_hero,
  jsonb_array_length(p.schemas)   as schema_entries
from public.posts p
join public.clients c on c.id = p.client_id
where c.slug = 'taverncreative'
order by p.published_at desc;
