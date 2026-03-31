const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding CinCin database (Phase 3)...");

  // ─── Test Users ───
  const password = await bcrypt.hash("TestPass1", 12);

  const host = await prisma.user.upsert({
    where: { email: "host@test.com" },
    update: {},
    create: {
      email: "host@test.com",
      passwordHash: password,
      displayName: "Test Host",
      ageVerified: true,
      ageVerifiedAt: new Date(),
      emailVerified: true,
      emailVerifiedAt: new Date(),
      subscriptionTier: "PRO",
    },
  });

  const player2 = await prisma.user.upsert({
    where: { email: "player2@test.com" },
    update: {},
    create: {
      email: "player2@test.com",
      passwordHash: password,
      displayName: "Player Two",
      ageVerified: true,
      ageVerifiedAt: new Date(),
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  const player3 = await prisma.user.upsert({
    where: { email: "player3@test.com" },
    update: {},
    create: {
      email: "player3@test.com",
      passwordHash: password,
      displayName: "Player Three",
      ageVerified: true,
      ageVerifiedAt: new Date(),
      emailVerified: true,
      emailVerifiedAt: new Date(),
      subscriptionTier: "PRO",
    },
  });

  // Phase 3: Additional test user for multi-device testing
  const player4 = await prisma.user.upsert({
    where: { email: "player4@test.com" },
    update: {},
    create: {
      email: "player4@test.com",
      passwordHash: password,
      displayName: "Player Four",
      ageVerified: true,
      ageVerifiedAt: new Date(),
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  console.log("  ✅ Test users created (4 users)");

  // ─── Bottles (same as Phase 2 + 1 more) ───
  const bottles = [
    {
      name: "Penfolds Bin 389 Cabernet Shiraz",
      producer: "Penfolds",
      vintage: "2021",
      region: "South Australia",
      country: "Australia",
      category: "WINE",
      subcategory: "Cabernet Shiraz",
      varietal: "Cabernet Sauvignon / Shiraz",
      notes: [
        { note: "Rainier cherry", genericNote: "cherry", sourceTier: "PRODUCER" },
        { note: "French oak", genericNote: "oak", sourceTier: "PRODUCER" },
        { note: "dark chocolate", genericNote: "chocolate", sourceTier: "PRODUCER" },
        { note: "vanilla", genericNote: "vanilla", sourceTier: "CRITIC" },
        { note: "tobacco", genericNote: "tobacco", sourceTier: "CRITIC" },
        { note: "blackberry", genericNote: "blackberry", sourceTier: "AI_SYNTHESISED" },
        { note: "cedar", genericNote: "cedar", sourceTier: "AI_SYNTHESISED" },
        { note: "plum", genericNote: "plum", sourceTier: "AI_SYNTHESISED" },
      ],
    },
    {
      name: "Cloudy Bay Sauvignon Blanc",
      producer: "Cloudy Bay",
      vintage: "2023",
      region: "Marlborough",
      country: "New Zealand",
      category: "WINE",
      subcategory: "Sauvignon Blanc",
      varietal: "Sauvignon Blanc",
      notes: [
        { note: "passionfruit", genericNote: "tropical fruit", sourceTier: "PRODUCER" },
        { note: "grapefruit", genericNote: "citrus", sourceTier: "PRODUCER" },
        { note: "cut grass", genericNote: "green", sourceTier: "CRITIC" },
        { note: "gooseberry", genericNote: "berry", sourceTier: "CRITIC" },
        { note: "lemongrass", genericNote: "herb", sourceTier: "AI_SYNTHESISED" },
        { note: "white peach", genericNote: "peach", sourceTier: "AI_SYNTHESISED" },
      ],
    },
    {
      name: "Stone & Wood Pacific Ale",
      producer: "Stone & Wood",
      vintage: null,
      region: "Byron Bay",
      country: "Australia",
      category: "BEER",
      subcategory: "Pale Ale",
      notes: [
        { note: "Galaxy hops", genericNote: "hops", sourceTier: "PRODUCER" },
        { note: "passionfruit", genericNote: "tropical fruit", sourceTier: "PRODUCER" },
        { note: "citrus peel", genericNote: "citrus", sourceTier: "CRITIC" },
        { note: "biscuit malt", genericNote: "malt", sourceTier: "CRITIC" },
        { note: "mango", genericNote: "tropical fruit", sourceTier: "AI_SYNTHESISED" },
        { note: "pine resin", genericNote: "resin", sourceTier: "AI_SYNTHESISED" },
      ],
    },
    {
      name: "Archie Rose White Rye",
      producer: "Archie Rose",
      vintage: null,
      region: "Sydney",
      country: "Australia",
      category: "SPIRITS",
      subcategory: "Whisky",
      notes: [
        { note: "rye spice", genericNote: "spice", sourceTier: "PRODUCER" },
        { note: "honey", genericNote: "honey", sourceTier: "PRODUCER" },
        { note: "vanilla cream", genericNote: "vanilla", sourceTier: "CRITIC" },
        { note: "white pepper", genericNote: "pepper", sourceTier: "CRITIC" },
        { note: "butterscotch", genericNote: "caramel", sourceTier: "AI_SYNTHESISED" },
        { note: "dried apricot", genericNote: "stone fruit", sourceTier: "AI_SYNTHESISED" },
        { note: "clove", genericNote: "spice", sourceTier: "AI_SYNTHESISED" },
      ],
    },
    {
      name: "Tyrrell's Vat 1 Semillon",
      producer: "Tyrrell's",
      vintage: "2018",
      region: "Hunter Valley",
      country: "Australia",
      category: "WINE",
      subcategory: "Semillon",
      varietal: "Semillon",
      notes: [
        { note: "lemon curd", genericNote: "citrus", sourceTier: "PRODUCER" },
        { note: "beeswax", genericNote: "wax", sourceTier: "PRODUCER" },
        { note: "toast", genericNote: "toast", sourceTier: "CRITIC" },
        { note: "lanolin", genericNote: "wool", sourceTier: "CRITIC" },
        { note: "dried herb", genericNote: "herb", sourceTier: "AI_SYNTHESISED" },
        { note: "almond", genericNote: "nut", sourceTier: "AI_SYNTHESISED" },
        { note: "white peach", genericNote: "peach", sourceTier: "AI_SYNTHESISED" },
      ],
    },
    {
      name: "Henschke Hill of Grace",
      producer: "Henschke",
      vintage: "2018",
      region: "Eden Valley",
      country: "Australia",
      category: "WINE",
      subcategory: "Shiraz",
      varietal: "Shiraz",
      notes: [
        { note: "Morello cherry", genericNote: "cherry", sourceTier: "PRODUCER" },
        { note: "sage", genericNote: "herb", sourceTier: "PRODUCER" },
        { note: "smoked meat", genericNote: "smoke", sourceTier: "CRITIC" },
        { note: "graphite", genericNote: "mineral", sourceTier: "CRITIC" },
        { note: "five spice", genericNote: "spice", sourceTier: "AI_SYNTHESISED" },
        { note: "violets", genericNote: "floral", sourceTier: "AI_SYNTHESISED" },
        { note: "black olive", genericNote: "olive", sourceTier: "AI_SYNTHESISED" },
        { note: "liquorice", genericNote: "liquorice", sourceTier: "AI_SYNTHESISED" },
        { note: "iron", genericNote: "mineral", sourceTier: "AI_SYNTHESISED" },
      ],
    },
    {
      name: "Balter XPA",
      producer: "Balter",
      vintage: null,
      region: "Gold Coast",
      country: "Australia",
      category: "BEER",
      subcategory: "XPA",
      notes: [
        { note: "tropical hops", genericNote: "hops", sourceTier: "PRODUCER" },
        { note: "pineapple", genericNote: "tropical fruit", sourceTier: "PRODUCER" },
        { note: "grapefruit rind", genericNote: "citrus", sourceTier: "CRITIC" },
        { note: "pale malt", genericNote: "malt", sourceTier: "CRITIC" },
        { note: "guava", genericNote: "tropical fruit", sourceTier: "AI_SYNTHESISED" },
        { note: "lychee", genericNote: "tropical fruit", sourceTier: "AI_SYNTHESISED" },
      ],
    },
    // Phase 3: Additional bottle for Cellar Club testing
    {
      name: "Torbreck RunRig",
      producer: "Torbreck",
      vintage: "2019",
      region: "Barossa Valley",
      country: "Australia",
      category: "WINE",
      subcategory: "Shiraz Viognier",
      varietal: "Shiraz / Viognier",
      notes: [
        { note: "blackberry compote", genericNote: "blackberry", sourceTier: "PRODUCER" },
        { note: "star anise", genericNote: "spice", sourceTier: "PRODUCER" },
        { note: "dark plum", genericNote: "plum", sourceTier: "CRITIC" },
        { note: "smoked paprika", genericNote: "smoke", sourceTier: "CRITIC" },
        { note: "violets", genericNote: "floral", sourceTier: "AI_SYNTHESISED" },
        { note: "licorice root", genericNote: "liquorice", sourceTier: "AI_SYNTHESISED" },
        { note: "espresso", genericNote: "coffee", sourceTier: "AI_SYNTHESISED" },
        { note: "new leather", genericNote: "leather", sourceTier: "AI_SYNTHESISED" },
      ],
    },
  ];

  for (const bottleData of bottles) {
    const { notes, ...bottle } = bottleData;
    const created = await prisma.bottle.upsert({
      where: { id: `seed-${bottle.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}` },
      update: {},
      create: {
        id: `seed-${bottle.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        ...bottle,
        tastingNotes: { create: notes },
      },
    });
  }

  console.log(`  ✅ ${bottles.length} bottles with tasting notes created`);

  // ─── Flavour Taxonomy (same as Phase 2) ───
  const taxonomyRoot = [
    { name: "fruity", isGeneric: true, children: [
      { name: "cherry", isGeneric: true, children: [
        { name: "Rainier cherry" }, { name: "Morello cherry" }, { name: "maraschino cherry" },
      ]},
      { name: "berry", isGeneric: true, children: [
        { name: "blackberry" }, { name: "blueberry" }, { name: "raspberry" }, { name: "strawberry" },
      ]},
      { name: "citrus", isGeneric: true, children: [
        { name: "lemon" }, { name: "grapefruit" }, { name: "Meyer lemon" }, { name: "orange zest" },
      ]},
      { name: "tropical fruit", isGeneric: true, children: [
        { name: "passionfruit" }, { name: "mango" }, { name: "pineapple" }, { name: "guava" }, { name: "lychee" },
      ]},
      { name: "plum", isGeneric: true, children: [
        { name: "dark plum" }, { name: "damson plum" },
      ]},
      { name: "peach", isGeneric: true, children: [
        { name: "white peach" }, { name: "yellow peach" },
      ]},
      { name: "stone fruit", isGeneric: true, children: [
        { name: "dried apricot" }, { name: "nectarine" },
      ]},
    ]},
    { name: "oak & wood", isGeneric: true, children: [
      { name: "oak", isGeneric: true, children: [
        { name: "French oak" }, { name: "American oak" }, { name: "charred oak" },
      ]},
      { name: "cedar" }, { name: "sandalwood" },
    ]},
    { name: "spice", isGeneric: true, children: [
      { name: "pepper", isGeneric: true, children: [
        { name: "black pepper" }, { name: "white pepper" },
      ]},
      { name: "cinnamon" }, { name: "clove" }, { name: "nutmeg" },
      { name: "star anise" }, { name: "five spice" }, { name: "rye spice" },
    ]},
    { name: "floral", isGeneric: true, children: [
      { name: "violets" }, { name: "rose" }, { name: "lavender" }, { name: "elderflower" },
    ]},
    { name: "earthy", isGeneric: true, children: [
      { name: "tobacco" }, { name: "leather" }, { name: "truffle" }, { name: "mushroom" },
      { name: "new leather" },
    ]},
    { name: "mineral", isGeneric: true, children: [
      { name: "graphite" }, { name: "wet stone" }, { name: "slate" }, { name: "iron" },
    ]},
    { name: "sweet", isGeneric: true, children: [
      { name: "vanilla", isGeneric: true, children: [
        { name: "vanilla bean" }, { name: "vanilla cream" },
      ]},
      { name: "chocolate", isGeneric: true, children: [
        { name: "dark chocolate" }, { name: "milk chocolate" }, { name: "cocoa" },
      ]},
      { name: "caramel", isGeneric: true, children: [
        { name: "butterscotch" }, { name: "toffee" },
      ]},
      { name: "honey" },
    ]},
    { name: "herbal & green", isGeneric: true, children: [
      { name: "herb", isGeneric: true, children: [
        { name: "sage" }, { name: "thyme" }, { name: "dried herb" }, { name: "lemongrass" },
      ]},
      { name: "green", isGeneric: true, children: [
        { name: "cut grass" }, { name: "green pepper" },
      ]},
      { name: "olive", isGeneric: true, children: [
        { name: "black olive" }, { name: "green olive" },
      ]},
    ]},
  ];

  async function createNodes(nodes, parentId = null) {
    for (const node of nodes) {
      const { children, ...data } = node;
      const existing = await prisma.flavourNode.findFirst({
        where: { name: data.name, parentId },
      });
      const created = existing || await prisma.flavourNode.create({
        data: { ...data, parentId, isGeneric: data.isGeneric || false, drinkTypes: ["WINE", "BEER", "SPIRITS"] },
      });
      if (children) await createNodes(children, created.id);
    }
  }

  await createNodes(taxonomyRoot);
  console.log("  ✅ Flavour taxonomy seeded");

  // ─── Phase 3: Cellar Club test data ───
  // Create a test club with a season
  const existingClub = await prisma.cellarClub.findFirst({ where: { adminId: host.id } });
  if (!existingClub) {
    const club = await prisma.cellarClub.create({
      data: {
        adminId: host.id,
        name: "Friday Night Vino",
        memberCap: 10,
        inviteCode: "FNV001",
        inviteLink: "http://localhost:3000/club/join/FNV001",
        members: {
          createMany: {
            data: [
              { userId: host.id, role: "ADMIN" },
              { userId: player2.id, role: "MEMBER" },
              { userId: player3.id, role: "MEMBER" },
            ],
          },
        },
        seasons: {
          create: {
            name: "Season 1",
            seasonType: "FIXED_LENGTH",
            startDate: new Date(),
            lengthDays: 90,
            status: "ACTIVE",
          },
        },
        activities: {
          createMany: {
            data: [
              { type: "SEASON_STARTED", actorId: host.id, data: { seasonName: "Season 1" } },
              { type: "MEMBER_JOINED", actorId: player2.id, data: { displayName: "Player Two" } },
              { type: "MEMBER_JOINED", actorId: player3.id, data: { displayName: "Player Three" } },
            ],
          },
        },
      },
    });
    console.log("  ✅ Test Cellar Club created: Friday Night Vino");
  }

  console.log("\n🎉 Phase 3 seeding complete!");
}

main()
  .catch((e) => {
    console.error("Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
