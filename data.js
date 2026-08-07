// ============================================================
// CIVILIZATION: DOMINION — content data
// Country ids match region ids produced by build_map.cs (mapdata.js)
// Species stats: [intelligence, strength, durability, agility,
//                 growth, productivity, diplomacy, morale, adaptability] (1-10)
// Small Humanity Update: Humans ALONE exceed the scale with 11 Intelligence —
// every other species stays capped at 10.
// ============================================================
"use strict";

// Diagnostic Update §4: the game's build identifier. It rides in every
// multiplayer handshake message — host and clients must match EXACTLY or the
// join is refused (net.js). Bump this with every shipped update.
const GAME_VERSION = "1.9.0 (2026-08-07)";

const ERAS = [null,
  { n: "Primitive Era",      icon: "🪨" },
  { n: "Ancient Era",        icon: "🏛" },
  { n: "Medieval Era",       icon: "🏰" },
  { n: "Industrial Era",     icon: "⚙" },
  { n: "Modern Era",         icon: "🏙" },
  { n: "Information Era",    icon: "🖥" },
  { n: "Futuristic Era",     icon: "🔮" },
  { n: "Interplanetary Era", icon: "🚀" },
  { n: "Megastructure Era",  icon: "🌌" },
];

const GOVS = {
  king:      { n: "King",      title: "King",      eff: "+10% stability, −5% research",            stab: 10, research: -0.05 },
  president: { n: "President", title: "President", eff: "+10% research, +10% diplomacy gains",     research: 0.10, dip: 0.10 },
  dictator:  { n: "Dictator",  title: "Dictator",  eff: "+15% army attack, −8 morale",             atk: 0.15, morale: -8 },
  emperor:   { n: "Emperor",   title: "Emperor",   eff: "+10% production, occupation −25% unrest", prod: 0.10, occup: 0.25 },
  council:   { n: "Council",   title: "Speaker",   eff: "+8 morale, −10% army attack",             moraleB: 8, atk: -0.10 },
};

// personalities: aggressive | defensive | peaceful | scientific | mercantile | expansionist
const NATIONS = {
1:{n:"Boreath",sp:"Jotunar",per:"defensive",gov:"king",st:[3,10,10,2,2,6,3,7,4],
  ap:"Four-metre frost giants with glacier-blue skin and beards of rime.",lg:"Jotunar-Kel (rumbling glacial tongue)",
  cu:"Clans gather around fire-pits carved in the ice shelf; oaths are sworn on frozen meteors.",ts:"Massive stonework and cold-forged iron; technology moves slowly but is nearly indestructible.",
  str:["Immense strength","Unmatched durability","Fearless"],wk:["Very slow research","Tiny birth rate","Poor diplomats"],
  ab:{n:"Glacial Bulwark",d:"+25% defence in battle",def:0.25},
  hi:"The Jotunar have held the southern ice since the world froze it. No invader has ever wintered there twice."},
2:{n:"Terravia",sp:"Humans",per:"scientific",gov:"president",st:[11,3,3,5,6,6,8,5,9],
  ap:"Adaptable primates of middling build — unremarkable bodies, restless minds.",lg:"Terran (rapid, borrowing from every tongue)",
  cu:"Cities of glass and argument; humans prize invention, trade and stubborn hope — and dream, uneasily, of a sky full of ghosts.",ts:"Fast, iterative engineering — and, some whisper, half-remembered echoes of machines from before the Long Sleep.",
  str:["High intelligence","Fast research","Great engineering","Skilled diplomacy","High adaptability"],wk:["Low physical strength","Low natural durability","Weak early melee units","Dependent on equipment"],
  ab:{n:"Ingenuity",d:"+30% research points",research:0.30},
  hi:"Humans once ruled much of the universe — until greed split them into warring factions armed with weapons that could unmake whole galaxies. The war ended when there was almost nothing left to win; the universe fell silent. A handful escaped in capsules that drifted for ages before falling on this impossibly habitable world. They slept ten thousand years, and woke with their memories burned away. Now they rebuild from the first stone — while somewhere, buried and patient, the ruins of their ancient empire may still be waiting to be found."},
3:{n:"Mycelior",sp:"Sporeborn",per:"scientific",gov:"council",st:[7,3,7,2,8,6,4,6,7],
  ap:"Walking fungal colonies crowned with luminous caps, joined by an underground mind-lattice.",lg:"Sporesign (chemical drift and slow pulses of light)",
  cu:"No individual owns anything; memory is shared through the mycel-web beneath their forests.",ts:"Grown, not built — living architecture and enzyme refineries.",
  str:["Shared memory","Regeneration","High growth"],wk:["Slow-moving","Fire is lethal","Isolationist"],
  ab:{n:"Mycel Network",d:"+15% food production",food:0.15},
  hi:"The Sporeborn woke beneath the great island forest and have quietly digested every empire that tried to log it."},
4:{n:"Ashvara",sp:"Vashkar",per:"aggressive",gov:"emperor",st:[6,9,8,6,3,4,3,8,4],
  ap:"Wingless drake-folk with obsidian scales and furnace-orange eyes.",lg:"Vash (hissed court dialect, roared war dialect)",
  cu:"An honour-bound flame cult; rank is settled in ritual duels above lava vents.",ts:"Fire-forged alloys and siege beasts of bronze.",
  str:["Powerful warriors","Armoured scales","Terrifying charge"],wk:["Few hatchlings","Proud and insular","Weak diplomats"],
  ab:{n:"Dragonfire",d:"+20% attack in battle",atk:0.20},
  hi:"The Vashkar burned their name into the southern deserts long before lesser species learned to write it."},
5:{n:"Verdanth",sp:"Sylvarin",per:"peaceful",gov:"council",st:[7,4,7,2,4,7,7,6,5],
  ap:"Slender treefolk with bark skin and canopies of seasonal leaves.",lg:"Sylvic (wind through branches, formalised)",
  cu:"Groves are parliaments; decisions ripen for years before they fall.",ts:"Living wood shaped over decades into homes, dams and bows.",
  str:["Patient wisdom","Self-repairing homes","Beloved mediators"],wk:["Rooted and slow","Dread of fire","Slow armies"],
  ab:{n:"Deep Roots",d:"+15% materials production",mat:0.15},
  hi:"The Sylvarin remember the first forest of the north-west and consider the other nations energetic saplings."},
6:{n:"Umbrawood",sp:"Umbrai",per:"aggressive",gov:"dictator",st:[6,6,4,9,4,4,3,6,5],
  ap:"Black-furred panther-folk that seem stitched from the forest's shadow.",lg:"Umbral (near-silent sign and purr)",
  cu:"The Unseen Court rules; to be noticed is to have failed.",ts:"Silent weapons, dyes that eat light.",
  str:["Ambush lords","Superb agility","Fear as a weapon"],wk:["Thin armour","Small population"],
  ab:{n:"Shadow Strike",d:"+15% attack, +10% espionage",atk:0.15,esp:0.10},
  hi:"Caravans crossing the deep wood pay Umbrawood's toll without ever seeing the collector."},
7:{n:"Tesskar",sp:"Vulpiri",per:"mercantile",gov:"president",st:[7,3,4,8,5,5,8,5,6],
  ap:"Quick russet fox-folk with clever hands and cleverer smiles.",lg:"Vulpine (fast, idiom-riddled)",
  cu:"Everything is negotiable except a signed contract.",ts:"Precision tools, locks, ledgers and later, markets.",
  str:["Master traders","Charming envoys","Nimble"],wk:["Fragile in melee","Reputation for tricks"],
  ab:{n:"Silver Tongue",d:"+20% money income",money:0.20},
  hi:"Tesskar banks financed half the continent's wars — and both sides of several."},
8:{n:"Sandsear",sp:"Scorpiox",per:"aggressive",gov:"dictator",st:[4,8,7,6,5,5,3,7,6],
  ap:"Chitin-plated scorpion-folk, stinger-tailed, eyes like black glass.",lg:"Skitterspeech (clicks echoed through sand)",
  cu:"Warbands roam the great erg; water-debt is the only law that binds them.",ts:"Venom-alchemy and lightweight chitin armour.",
  str:["Desert masters","Venom strikes","Hardy raiders"],wk:["Cold-blooded in winter","Feared by neighbours","Poor scholars"],
  ab:{n:"Venom Strike",d:"Enemy suffers +10% casualties",cas:0.10},
  hi:"Scorpiox hosts have crossed the central sands for a thousand seasons, taxing every caravan that survives them."},
9:{n:"Gravemoor",sp:"Gnollic",per:"aggressive",gov:"dictator",st:[3,7,6,6,7,4,2,7,5],
  ap:"Cackling hyena-folk in scavenged mismatched armour.",lg:"Gnoll-yap (laughter with teeth in it)",
  cu:"Nothing is wasted, nothing is sacred, everything is funny.",ts:"Scavenged and improvised — ugly, cheap, effective.",
  str:["Cheap armies","Fearless","Fast breeders"],wk:["Chaotic","Universally distrusted"],
  ab:{n:"Scavengers",d:"−20% unit recruitment cost",cheapUnits:0.20},
  hi:"Gravemoor's neighbours agree on exactly one thing: lock the granaries when the laughing starts."},
10:{n:"Fenmarsh",sp:"Croakan",per:"mercantile",gov:"council",st:[4,5,6,7,8,5,5,5,7],
  ap:"Broad-mouthed amphibian folk, skin patterned like wet river stones.",lg:"Croakan (booming swamp chorus)",
  cu:"Flooded market-villages on stilts; haggling is performance art.",ts:"Reed-craft, dyes and river engineering.",
  str:["Amphibious","Rapid spawning","Canny traders"],wk:["Dry heat withers them","Unsteady soldiers"],
  ab:{n:"Spawning Pools",d:"+20% population growth",growth:0.20},
  hi:"Fenmarsh grew rich ferrying goods across the central wetlands while grander nations drowned in them."},
11:{n:"Tarnmoor",sp:"Saurin",per:"defensive",gov:"council",st:[5,6,6,6,6,5,4,5,8],
  ap:"Mottled lizardfolk able to shift skin-colour with the terrain.",lg:"Saur (sibilant, tail-gesture inflected)",
  cu:"Wandering clutch-families; the land itself is the only temple.",ts:"Practical adaptations borrowed from every biome.",
  str:["Extreme adaptability","Ambush experts","Hardy"],wk:["Loose organisation","Few grand cities"],
  ab:{n:"Chameleon Skin",d:"No terrain penalty when attacking",noTerrain:true},
  hi:"Tarnmoor's borders moved with the seasons until its neighbours drew them in ink; the Saurin shrugged and adapted."},
12:{n:"Korrahl",sp:"Ursune",per:"defensive",gov:"king",st:[5,8,8,3,4,6,5,7,4],
  ap:"Great bear-folk in riveted hide armour smelling of honey and iron.",lg:"Ursk (low growl-song)",
  cu:"Long winter feasts, longer memories; guests are sacred, trespassers are meals.",ts:"Timber fortresses and heavy smithing.",
  str:["Mighty defenders","Winter-proof","Loyal"],wk:["Sleepy summers","Slow to mobilise"],
  ab:{n:"Winter Guard",d:"+20% defence in battle",def:0.20},
  hi:"Korrahl has never been conquered; several armies are still politely buried under its orchards."},
13:{n:"Grimmark",sp:"Urgral",per:"aggressive",gov:"dictator",st:[3,9,7,5,7,4,2,8,5],
  ap:"Tusked, slab-muscled orcs painted with ash war-sigils.",lg:"Urgral-Kha (barked commands, drum grammar)",
  cu:"Strength is currency; the Skull-Moot crowns whoever survives it.",ts:"Crude but brutally effective ironmongery.",
  str:["Ferocious melee","Fast-breeding hordes","Pain-proof"],wk:["Despise book-learning","Constant infighting","Hated by neighbours"],
  ab:{n:"Blood Fury",d:"+15% attack, +5% casualties taken",atk:0.15,selfCas:0.05},
  hi:"Grimmark warbands have tested the human frontier every generation — and remember losing none of it."},
14:{n:"Duskfell",sp:"Fenrik",per:"aggressive",gov:"king",st:[5,7,5,9,5,4,3,8,5],
  ap:"Grey-pelted wolf-folk with lantern eyes bred for the long dusk.",lg:"Fenric (howled over leagues)",
  cu:"The pack is law; the hunt is worship; winter is the year's true king.",ts:"Sinew, steel and speed — light gear for fast war.",
  str:["Fast raiders","Pack tactics","Night fighters"],wk:["Thin logistics","Restless peace"],
  ab:{n:"Pack Hunt",d:"+15% attack in battle",atk:0.15},
  hi:"Duskfell packs shadowed the human frontier for centuries, testing fences and patience alike."},
15:{n:"Skyreach",sp:"Aeloran",per:"expansionist",gov:"emperor",st:[6,5,3,10,4,4,5,6,5],
  ap:"Hawk-folk with storm-grey wings and gold-ringed eyes.",lg:"Aelic (cries pitched to altitude)",
  cu:"Status is altitude; the Sun-Eyrie crowns whoever nests highest.",ts:"Gliders, signal-mirrors, wind-charts.",
  str:["Aerial scouts","Fastest raiders","Far-seeing"],wk:["Hollow bones","Small clutches"],
  ab:{n:"High Watch",d:"Enemy armies always revealed",vision:true},
  hi:"Skyreach maps showed the whole western sea a century before anyone below sailed it."},
16:{n:"Duneveil",sp:"Sissath",per:"mercantile",gov:"emperor",st:[7,5,5,7,4,4,6,5,6],
  ap:"Cobra-hooded serpent-folk robed in sun-bleached silk.",lg:"Sissa (whispered, half of it deniable)",
  cu:"Truth is a luxury good; the Veiled Court trades in secrets.",ts:"Optics, poisons, and message-networks across the dunes.",
  str:["Espionage masters","Heat-proof","Subtle diplomats"],wk:["Distrusted widely","Brittle bones"],
  ab:{n:"Veiled Agents",d:"+20% espionage success",esp:0.20},
  hi:"Duneveil has lost every open war it fought and somehow profited from each of them."},
17:{n:"Verdisle",sp:"Simmian",per:"mercantile",gov:"council",st:[7,4,3,9,7,4,6,5,6],
  ap:"Long-limbed monkey-folk crowned with braided canopy-vines.",lg:"Simmic (chattering, tonal)",
  cu:"The canopy is one endless market street.",ts:"Rope-ways, pulleys and shipboard rigging.",
  str:["Agile sailors","Quick learners","Cheerful traders"],wk:["Fragile","Easily bored"],
  ab:{n:"Canopy Trade",d:"+15% money income",money:0.15},
  hi:"Verdisle's rope-bridges reach islands its rivals still call unreachable."},
18:{n:"Maruw",sp:"Luvrine",per:"peaceful",gov:"council",st:[6,4,4,8,6,5,7,6,6],
  ap:"Sleek otter-folk, never far from water or laughter.",lg:"Luvric (bubbling, quick)",
  cu:"Rafthome flotillas; property is whatever floats beside you.",ts:"Boats, weirs, nets — the coast is their workshop.",
  str:["Superb sailors","Cheerful morale","Fast swimmers"],wk:["Poor heavy infantry","Easily raided"],
  ab:{n:"Tidecraft",d:"+15% food, coastal attacks unlocked early",food:0.15,earlyNavy:true},
  hi:"Maruw's fleets carried the first letters between continents — and read most of them en route."},
19:{n:"Thicketh",sp:"Scarabid",per:"mercantile",gov:"king",st:[4,6,7,4,7,8,3,6,5],
  ap:"Lacquered beetle-folk, horned and tireless.",lg:"Scarabic (wing-case percussion)",
  cu:"Work is prayer; the Great Ledger records every load ever carried.",ts:"Mass haulage, granaries, early assembly methods.",
  str:["Tireless workers","Armoured bodies","Vast granaries"],wk:["Rigid thinking","Slow envoys"],
  ab:{n:"Hive Industry",d:"+15% production speed",prod:0.15},
  hi:"Thicketh built the central continent's roads and has quietly owned its tolls ever since."},
20:{n:"Frosthollow",sp:"Wendel",per:"defensive",gov:"king",st:[4,8,8,3,3,5,4,7,4],
  ap:"White-furred yeti-kin, wide as doors, gentle until provoked.",lg:"Wendic (soft under-snow rumble)",
  cu:"Hearth-halls dug into the glacier; storytelling is the winter economy.",ts:"Bone, hide and ice-cut stone.",
  str:["Blizzard fighters","Enormous strength","Warm hosts"],wk:["Suffer in heat","Few in number"],
  ab:{n:"Blizzard Born",d:"+25% defence in snow homeland",def:0.15},
  hi:"Frosthollow greets lost travellers with soup and directions — and greets armies with avalanches."},
21:{n:"Cindral",sp:"Terracot",per:"defensive",gov:"council",st:[4,6,9,2,3,9,3,6,4],
  ap:"Fired-clay folk, kiln-born, glowing faintly at the seams.",lg:"Terric (bell-tones struck on their own chests)",
  cu:"Each generation is sculpted by the last; the Kiln is temple and cradle.",ts:"Ceramics beyond steel, furnace-craft.",
  str:["Fireproof","Tireless builders","Uniform discipline"],wk:["Shatter when flanked","No natural growth"],
  ab:{n:"Kiln Born",d:"+20% production speed",prod:0.20},
  hi:"Cindral rebuilt itself brick by brick after every war — usually improved."},
22:{n:"Drennak",sp:"Thornhide",per:"aggressive",gov:"king",st:[3,8,7,4,6,5,2,8,4],
  ap:"Bristle-backed boar-folk whose charge splinters shield-walls.",lg:"Drenn (grunted sagas)",
  cu:"Feast, fight, boast, repeat; cowardice is the only sin.",ts:"Heavy leather, heavier axes.",
  str:["Devastating charge","Thick hide","High morale"],wk:["No patience for craft","Blunt diplomacy"],
  ab:{n:"Tusk Charge",d:"+20% attack when attacking",atkOnly:0.20},
  hi:"Drennak's sagas list four hundred glorious defeats and insist every one was worth it."},
23:{n:"Mirrorsalt",sp:"Prismari",per:"scientific",gov:"council",st:[9,3,7,2,2,6,4,6,3],
  ap:"Faceted crystal-folk refracting slow rainbows as they think.",lg:"Prismatic (light-pulse lattice)",
  cu:"Thought is communal; disagreement is diffraction, not conflict.",ts:"Optics, resonance engines, light-based computing early.",
  str:["Brilliant minds","Ageless","Beautiful cities"],wk:["Shatter under blunt force","Near-zero growth"],
  ab:{n:"Lattice Mind",d:"+20% research points",research:0.20},
  hi:"The salt flats sing at dawn; the Prismari insist that is simply the university holding lectures."},
24:{n:"Rookhollow",sp:"Corvax",per:"scientific",gov:"council",st:[8,3,3,7,5,4,6,5,6],
  ap:"Glossy raven-folk in ink-stained scholar robes, pockets full of borrowed things.",lg:"Corvic (croaked riddles and mimicry)",
  cu:"The Parliament of Perches trades in secrets; a shiny fact outranks a shiny coin.",ts:"Codes, couriers and clockwork lockpicks.",
  str:["Sharp minds","Master observers","Never forget a face"],wk:["Frail bodies","Compulsive collectors"],
  ab:{n:"Watchful Flock",d:"+10% research, +10% espionage",research:0.10,esp:0.10},
  hi:"Rookhollow's spies read the human frontier's letters for a century before anyone noticed the missing wax seals."},
25:{n:"Stonhearth",sp:"Karrun",per:"defensive",gov:"king",st:[6,6,8,3,4,9,5,7,3],
  ap:"Stocky delver-folk with braided beards and hands like vices.",lg:"Karrunic (rune-carved, rarely spoken aloud)",
  cu:"The mountain is ancestor, vault and fortress in one.",ts:"Peerless stonework, deep mines, stubborn machines.",
  str:["Master builders","Rich mines","Unbreakable morale"],wk:["Landlocked","Suspicious of sky"],
  ab:{n:"Deep Forges",d:"+20% materials production",mat:0.20},
  hi:"Stonhearth's gates have closed three times in history; each time, the besieger starved first."},
26:{n:"Cactun",sp:"Cactid",per:"defensive",gov:"council",st:[4,4,9,2,5,6,4,6,8],
  ap:"Spined succulent-folk storing a season of water in their trunks.",lg:"Cactic (creaks and precise silences)",
  cu:"Patience is the highest art; grudges are watered for decades.",ts:"Water-harvest engineering and needle-craft.",
  str:["Thirst-proof","Painful to attack","Long-lived"],wk:["Very slow","Frost is deadly"],
  ab:{n:"Thorned Hide",d:"Attackers suffer +10% casualties",cas:0.10},
  hi:"Cactun has survived six desert empires by simply outlasting the concept of empire."},
27:{n:"Vinreath",sp:"Viperi",per:"aggressive",gov:"dictator",st:[6,5,4,8,4,4,4,6,5],
  ap:"Emerald serpent-folk moving like poured water.",lg:"Viperic (paired-meaning hisses)",
  cu:"The Coil ranks all; ambition is expected, patience rewarded.",ts:"Toxins, curved blades, coastal galleys.",
  str:["Lethal strikes","Silent movement","Sea raiders"],wk:["Cold slows them","Thin armour"],
  ab:{n:"Coiled Ambush",d:"+15% attack in battle",atk:0.15},
  hi:"Vinreath's harbour fees are modest. Refusing to pay them has proven less so."},
28:{n:"Lumenshade",sp:"Phalene",per:"peaceful",gov:"council",st:[7,2,3,8,6,5,7,5,6],
  ap:"Moth-folk with dust-soft wings that glow in moonlight.",lg:"Phalic (wing-shimmer and scent)",
  cu:"Night festivals of lantern-dance; light is currency and art.",ts:"Silk-weaving and phosphor-chemistry.",
  str:["Beloved artisans","Night travellers","Gentle envoys"],wk:["Fragile wings","Flame-drawn"],
  ab:{n:"Silk Wealth",d:"+15% money income",money:0.15},
  hi:"Lumenshade silk has ended sieges; generals surrender rather than burn the looms."},
29:{n:"Mistcrag",sp:"Petran",per:"defensive",gov:"king",st:[5,7,9,4,2,5,3,7,3],
  ap:"Winged gargoyle-folk of grey stone, motionless for days.",lg:"Petric (grinding consonants)",
  cu:"Perch-clans watch the straits; vigilance is worship.",ts:"Cliff-carving and wind-reading.",
  str:["Stone hide","Aerial sentries","Never surprised"],wk:["Slow reproduction","Rigid tradition"],
  ab:{n:"Stone Vigil",d:"+20% defence, armies revealed",def:0.20,vision:true},
  hi:"Ships passing Mistcrag swear the cliffs move. The cliffs decline to comment."},
30:{n:"Reedwater",sp:"Ciconi",per:"peaceful",gov:"president",st:[7,3,3,7,5,5,9,5,5],
  ap:"Tall heron-folk of deliberate step and impeccable plumage.",lg:"Ciconic (measured, courtly)",
  cu:"Etiquette is armour; a misplaced word ends careers.",ts:"Paper, protocol and river-locks.",
  str:["Legendary diplomats","Elegant cities","Neutral bankers"],wk:["Feeble soldiers","Slow decisions"],
  ab:{n:"Grand Envoys",d:"+2 relations from all diplomacy",dipB:2},
  hi:"Reedwater has ended more wars with dinner parties than most nations have with armies."},
31:{n:"Brackwater",sp:"Rattkin",per:"mercantile",gov:"council",st:[6,3,4,8,9,6,5,4,7],
  ap:"Wiry rat-folk in oilskin coats, whiskers twitching at every opportunity.",lg:"Rattic (dockside patter, six dialects deep)",
  cu:"The Wharfmoot rules; every family owns a boat, a ledger and at least one secret tunnel.",ts:"Salvage, smuggling craft and warehouse arithmetic.",
  str:["Explosive growth","Unsinkable traders","Thrive anywhere"],wk:["Poor open-field soldiers","Trusted by no customs officer"],
  ab:{n:"Black Market",d:"+15% money, −10% unit cost",money:0.15,cheapUnits:0.10},
  hi:"When human tariffs rise, Brackwater's fortunes rise faster. No one has ever proven the connection."},
32:{n:"Palmreach",sp:"Psittari",per:"peaceful",gov:"president",st:[6,3,3,7,6,4,9,5,6],
  ap:"Brilliant-plumed parrot-folk who never forget a spoken word.",lg:"Psittic (all languages, fluently, loudly)",
  cu:"The Grand Chorus: politics conducted as competitive song.",ts:"Shipcraft and signal-song networks.",
  str:["Perfect interpreters","Beloved everywhere","Fine sailors"],wk:["Cannot keep secrets","Weak soldiers"],
  ab:{n:"Thousand Tongues",d:"+3 relations from all diplomacy",dipB:3},
  hi:"Every treaty on the eastern sea was read aloud — twice — by a Palmreach herald."},
33:{n:"Hollowpine",sp:"Strigid",per:"scientific",gov:"council",st:[8,3,4,6,4,5,6,5,5],
  ap:"Round-eyed owl-folk in feather-cloaks lined with notebooks.",lg:"Strigian (soft hoots, dense grammar)",
  cu:"Night colleges in hollowed pines; sleep is for the unlettered.",ts:"Astronomy, cartography and patient record-keeping.",
  str:["Keen scholars","Night vision","Excellent memory"],wk:["Frail","Averse to open war"],
  ab:{n:"Night Study",d:"+15% research points",research:0.15},
  hi:"Hollowpine's star-charts are copied — badly — by every navy on the sea."},
34:{n:"Harthol",sp:"Meles",per:"defensive",gov:"council",st:[5,6,7,4,5,7,5,6,5],
  ap:"Broad-shouldered badger-folk with striped faces and earth under every claw.",lg:"Melic (steady burrow-drawl)",
  cu:"A field well-tilled and a wall well-built are the two Melic prayers.",ts:"Earthworks, root-cellars, and stubborn ploughs.",
  str:["Deep burrow-forts","Reliable harvests","Immovable in defence"],wk:["Slow marchers","No love of the sea"],
  ab:{n:"Deep Setts",d:"+1 fortification, +10% food",fortB:1,food:0.10},
  hi:"Harthol has been invaded eleven times. Its granaries have never once been found."},
35:{n:"Shoregrass",sp:"Capyb",per:"peaceful",gov:"council",st:[5,4,6,3,7,5,8,7,6],
  ap:"Placid capybara-folk, always damp, always unbothered.",lg:"Capric-Ba (slow riverside murmur)",
  cu:"The Warm Bank philosophy: there is room beside me; sit.",ts:"Reed rafts, hot springs and shared gardens.",
  str:["Everyone's friend","Unshakable calm","Steady growth"],wk:["Allergic to urgency","Gentle to a fault"],
  ab:{n:"Warm Banks",d:"+8 morale recovery",moraleR:8},
  hi:"Three armies have marched on Shoregrass. All three stayed for the hot springs and went home friends."},
36:{n:"Kilnrock",sp:"Ifrikin",per:"aggressive",gov:"king",st:[5,7,6,6,3,6,2,7,4],
  ap:"Ember-folk with cooling-crust skin over molten cores.",lg:"Ifric (crackling sparks)",
  cu:"The volcano is parliament; eruptions are considered strong speeches.",ts:"Magma-forging and obsidian edges.",
  str:["Fire immune","Fearsome smiths","Strong melee"],wk:["Water is deadly","Short tempers"],
  ab:{n:"Magma Forge",d:"+15% materials, +10% attack",mat:0.15,atk:0.10},
  hi:"Kilnrock exports the finest blades on the continent and several ongoing grudges."},
37:{n:"Thornfell",sp:"Erin",per:"defensive",gov:"council",st:[5,4,7,5,6,6,5,6,5],
  ap:"Round hedgehog-folk whose quills rise politely before they rise dangerously.",lg:"Erinic (soft chatter, sharp proverbs)",
  cu:"Every hearth keeps soup for travellers and a spear behind the door.",ts:"Hedge-laying, pikework and preserves.",
  str:["Bristling defence","Hard to besiege","Beloved neighbours"],wk:["Never attack first","Small stature"],
  ab:{n:"Quill Wall",d:"Attackers suffer +10% casualties",cas:0.10},
  hi:"Grimmark raiders call Thornfell 'the soup that bites' and raid elsewhere."},
38:{n:"Willowmere",sp:"Lepori",per:"peaceful",gov:"council",st:[5,2,3,9,10,5,6,4,6],
  ap:"Long-eared rabbit-folk, quick-footed and quicker-hearted.",lg:"Leporic (whisker-twitch and patter)",
  cu:"Warren-democracy: every burrow a vote, every spring a festival.",ts:"Gardens, burrow-craft, drums that carry for miles.",
  str:["Fastest growth","Early warning","Endearing envoys"],wk:["Terrified of war","No heavy troops"],
  ab:{n:"Warren Boom",d:"+25% population growth",growth:0.25},
  hi:"Willowmere has been invaded five times and simply out-bred every occupier."},
39:{n:"Glacielle",sp:"Rimewisp",per:"scientific",gov:"council",st:[9,2,4,7,2,4,5,5,3],
  ap:"Translucent frost-sprites trailing auroras of freezing mist.",lg:"Rimic (chimes at the edge of hearing)",
  cu:"Contemplation on the ice; each sprite polishes one Question for life.",ts:"Cold-crystal lenses and preserved knowledge.",
  str:["Luminous intellect","Ageless archives","Serene"],wk:["Melt in warm lands","Nearly no growth"],
  ab:{n:"Crystal Thought",d:"+20% research points",research:0.20},
  hi:"Glacielle's tiny isle holds answers to questions the mainland has not yet learned to ask."},
40:{n:"Hivelash",sp:"Formiccan",per:"expansionist",gov:"emperor",st:[5,5,5,5,9,9,2,7,5],
  ap:"Ant-folk in living armour, moving as one rippling column.",lg:"Formic (antennal code)",
  cu:"The Colony is the self; the Queen's dream is policy.",ts:"Tunnels, granaries and numberless hands.",
  str:["Explosive growth","Perfect coordination","Tireless"],wk:["Predictable","One mind to fool"],
  ab:{n:"Endless Column",d:"+20% population growth",growth:0.20},
  hi:"Hivelash's borders grow a field a year — never faster, never slower, never back."},
41:{n:"Gullwick",sp:"Larid",per:"mercantile",gov:"council",st:[6,3,3,8,6,5,6,5,6],
  ap:"Sharp-eyed gull-folk in salt-bleached oil-cloaks, loud before breakfast.",lg:"Laridic (shrieked over surf)",
  cu:"Finders-keepers is holy writ; the tide-line is a marketplace renewed twice daily.",ts:"Skiffs, salvage hooks and weatherglass.",
  str:["Fearless sailors","Storm-readers","Opportunists"],wk:["Quarrelsome","Cannot hold formation"],
  ab:{n:"Wreck Rights",d:"+15% money income",money:0.15},
  hi:"Gullwick's charter simply reads: 'What the sea gives Gullwick, Gullwick keeps.'"},
42:{n:"Oasyn",sp:"Dromedar",per:"mercantile",gov:"king",st:[5,5,7,4,5,6,7,5,7],
  ap:"Tall camel-folk robed against the sun, unhurried and unbothered.",lg:"Dromedic (long-breathed trade cant)",
  cu:"The oasis code: water first, business second, war a distant third.",ts:"Caravan logistics and star navigation.",
  str:["Desert endurance","Caravan wealth","Fair dealers"],wk:["Slow armies","Landlocked"],
  ab:{n:"Caravan Routes",d:"+15% money, +5% food",money:0.15,food:0.05},
  hi:"All desert roads rest at Oasyn; even Scorpiox raiders pay for their tea."},
43:{n:"Newtmere",sp:"Tritonid",per:"peaceful",gov:"council",st:[6,3,6,6,7,5,6,6,7],
  ap:"Speckled newt-folk with regrowing limbs and unhurried smiles.",lg:"Tritic (pond-ripple song)",
  cu:"Nothing is ever truly lost — limbs, harvests and friendships all grow back.",ts:"Wetland herb-lore and patient aquaculture.",
  str:["Regeneration","Wetland masters","Serene"],wk:["Dry-season lethargy","Soft-hearted"],
  ab:{n:"Regrowth",d:"+10% food, +10% growth",food:0.10,growth:0.10},
  hi:"Newtmere's healers stitched up soldiers from both sides of the Reedwater accords — then billed neither."},
44:{n:"Snowperch",sp:"Pingvar",per:"peaceful",gov:"council",st:[6,3,5,5,7,6,6,6,5],
  ap:"Dapper penguin-folk in natural formal dress.",lg:"Pingvic (huddle-song)",
  cu:"The Huddle decides all; warmth is shared or not at all.",ts:"Ice-harbours and communal stores.",
  str:["Cold sailors","Communal resilience","Diligent"],wk:["Flightless","Comically slow ashore"],
  ab:{n:"The Huddle",d:"+10 morale recovery",moraleR:10},
  hi:"Snowperch has weathered every winter, war and fashion the world could throw at it."},
45:{n:"Acornvale",sp:"Scurrid",per:"defensive",gov:"council",st:[6,2,3,9,8,7,5,5,6],
  ap:"Bright-eyed squirrel-folk who plan three winters ahead and forget where they planned it.",lg:"Scurric (chittered double-speed)",
  cu:"The Great Cache: a nation-wide hidden pantry no invader has ever emptied.",ts:"Tree-top granaries and rope-run logistics.",
  str:["Vast stockpiles","Lightning couriers","High growth"],wk:["Scatterbrained","Tiny soldiers"],
  ab:{n:"Great Cache",d:"+15% food production",food:0.15},
  hi:"Acornvale once fed three besieged neighbours through a winter and still turned a profit in spring."},
46:{n:"Tidepool",sp:"Axol",per:"scientific",gov:"council",st:[8,2,5,5,6,4,6,6,6],
  ap:"Smiling axolotl-folk with feathered gills of coral pink.",lg:"Axolic (bubbling glossolalia)",
  cu:"The Shallows Academy: medicine is the highest calling, taught waist-deep at low tide.",ts:"Regenerative salves and glass-bottle laboratories.",
  str:["Master healers","Regeneration","Curious minds"],wk:["Helpless ashore in heat","No warrior caste"],
  ab:{n:"Healing Waters",d:"+15% growth, +5% research",growth:0.15,research:0.05},
  hi:"Tidepool's physicians are welcome in every port — even ones at war with their patients."},
47:{n:"Mossvale",sp:"Shelldar",per:"defensive",gov:"king",st:[6,4,10,1,3,6,5,7,4],
  ap:"Great tortoise-folk whose shells are carved with family law.",lg:"Sheldric (slow, geological)",
  cu:"Decisions take years; buildings take centuries; both outlast everything.",ts:"Monumental masonry on living foundations.",
  str:["Living fortresses","Immense patience","Unshakable"],wk:["Glacially slow","Cannot pursue enemies"],
  ab:{n:"Shell Wall",d:"+30% defence in battle",def:0.30},
  hi:"Mossvale's border stones have not moved in nine hundred years, mostly because no one could move them."},
48:{n:"Cliffwatch",sp:"Caprid",per:"defensive",gov:"king",st:[5,6,7,7,4,5,4,7,6],
  ap:"Sure-footed goat-kin with curling horns and no fear of heights.",lg:"Capric (bleated echo-code)",
  cu:"Ledge-villages linked by rope; a handshake at altitude binds forever.",ts:"Terrace farming and mountain war.",
  str:["Mountain masters","Stubborn defence","Hardy"],wk:["Small nation","Headstrong"],
  ab:{n:"High Ground",d:"+20% defence in battle",def:0.20},
  hi:"Cliffwatch's border is vertical. Invaders tend to discover this suddenly."},
49:{n:"Elowen",sp:"Cervine",per:"scientific",gov:"council",st:[8,3,4,7,5,5,7,4,5],
  ap:"Antlered deer-folk hung with amulets of polished amber.",lg:"Elowic (sung vowels, seasonal dialects)",
  cu:"Memory-groves where history is carved into living antler-trees.",ts:"Herb-lore, glasswork and quiet observation.",
  str:["Wise scholars","Swift runners","Gentle envoys"],wk:["Skittish under fire","Low durability"],
  ab:{n:"Amber Lore",d:"+10% research, +5% food",research:0.10,food:0.05},
  hi:"Elowen archives predate most nations' alphabets, a fact they are too polite to mention twice."},
50:{n:"Ringatoll",sp:"Medusan",per:"peaceful",gov:"council",st:[6,2,5,4,6,4,6,5,7],
  ap:"Translucent jelly-folk drifting the lagoon in bell-chimes of colour.",lg:"Medusic (bioluminescent ripple)",
  cu:"The Lagoon Dream: slow art, tide-festivals, no clocks.",ts:"Coral-shaping and current-craft.",
  str:["Self-healing","Serene morale","Storm-readers"],wk:["Nearly defenceless ashore","Tiny nation"],
  ab:{n:"Reef Sanctuary",d:"+15% food, +1 fortification",food:0.15,fortB:1},
  hi:"Ringatoll has no army and, so far, no enemies willing to explain that to the reef."},
51:{n:"Mudburrow",sp:"Talpan",per:"defensive",gov:"council",st:[5,5,6,3,6,8,4,6,4],
  ap:"Velvet-furred mole-folk with spade-hands and star-shaped noses.",lg:"Talpic (taps and tunnel-echo)",
  cu:"The surface is a rumour; the true nation is forty fathoms of warm dark.",ts:"Deep mining, blind-forged metalwork.",
  str:["Unmatched miners","Invisible cities","Industrious"],wk:["Half-blind above ground","Distrust the open sky"],
  ab:{n:"Deep Veins",d:"+20% materials production",mat:0.20},
  hi:"Mudburrow's neighbours farm its roof and never guess what fortunes pass beneath their turnips."},
52:{n:"Palmshade",sp:"Iguanid",per:"peaceful",gov:"council",st:[5,5,7,4,4,4,6,7,6],
  ap:"Crested iguana-folk the colour of warm stone, professionally unhurried.",lg:"Iguic (long vowels, longer pauses)",
  cu:"The Basking Law: no decree may be issued before noon or after lunch.",ts:"Solar drying, stone terraces, siesta economics.",
  str:["Sun-powered stamina","Thick hides","Content citizens"],wk:["Cold mornings stop the state","Unambitious"],
  ab:{n:"Long Bask",d:"+10% energy, +5 morale recovery",energy:0.10,moraleR:5},
  hi:"Palmshade's one recorded war ended at midday, on schedule, for lunch — permanently."},
53:{n:"Crossmarch",sp:"Mustelid",per:"mercantile",gov:"president",st:[7,4,4,9,6,5,6,5,7],
  ap:"Sinuous weasel-folk in travel-worn cloaks with contraband-lined seams.",lg:"Mustic (border-cant, deliberately confusing)",
  cu:"Sitting on the crossroads of five armies, Crossmarch sells maps to all of them — subtly different ones.",ts:"Fast wagons, false floors, faster talking.",
  str:["Everywhere at once","Charming rogues","Fast couriers"],wk:["Nobody's ally for long","Thin armour"],
  ab:{n:"Toll Roads",d:"+15% money, +5% espionage",money:0.15,esp:0.05},
  hi:"Four empires have claimed Crossmarch on their maps. Crossmarch engraved all four maps, and was paid four times."},
54:{n:"Pearlshoal",sp:"Carcin",per:"defensive",gov:"king",st:[4,6,9,3,5,5,4,6,5],
  ap:"Armoured crab-folk sidling in mother-of-pearl plate.",lg:"Carcic (claw-click semaphore)",
  cu:"The Shoal grows its city from shell; nothing is discarded, ever.",ts:"Shell-lamination stronger than bronze.",
  str:["Natural armour","Amphibious","Patient"],wk:["Sideways logistics","Slow claws"],
  ab:{n:"Shell Plate",d:"+25% defence in battle",def:0.25},
  hi:"Pearlshoal's walls are seven centuries of moulted shell. They have never been breached, only admired."},
55:{n:"Tidegrass",sp:"Selkane",per:"peaceful",gov:"council",st:[6,4,5,7,6,5,7,6,6],
  ap:"Sleek seal-folk who walk ashore wrapped in kelp-wool.",lg:"Selkic (barking ballads)",
  cu:"Half the year at sea, all the year in song.",ts:"Skin-boats and weather-wisdom.",
  str:["Superb swimmers","Storm-proof","Warm-hearted"],wk:["Small numbers","Homesick ashore"],
  ab:{n:"Sea Bounty",d:"+20% food production",food:0.20},
  hi:"Tidegrass sailors have rescued crews from every flag — and been toasted under all of them."},
56:{n:"Jackalt",sp:"Sacalim",per:"aggressive",gov:"dictator",st:[5,6,5,8,6,4,3,6,7],
  ap:"Lean jackal-folk with dust-gold eyes, laughing at private jokes.",lg:"Sacalic (yipped code, changes weekly)",
  cu:"Raid at dusk, feast at midnight, vanish by dawn; glory is measured in what you carried home.",ts:"Light spears, faster sandals, borrowed everything else.",
  str:["Hit-and-run masters","Desert-hardy","Cunning"],wk:["Cannot hold ground","Feud-prone"],
  ab:{n:"Dusk Raid",d:"+15% attack when attacking",atkOnly:0.15},
  hi:"Jackalt has never won a battle that lasted past sunrise — and never fought one that did."},
57:{n:"Turnipdell",sp:"Arvic",per:"peaceful",gov:"council",st:[4,3,5,5,8,8,5,7,5],
  ap:"Plump vole-folk in patched aprons, permanently mid-harvest.",lg:"Arvic-Dell (comfortable mumbling)",
  cu:"The Root Census: every turnip is counted, named and, eventually, respected.",ts:"Crop rotation perfected into a quiet science.",
  str:["Bottomless larders","Content and steady","Everyone helps"],wk:["No martial tradition at all","Easily startled"],
  ab:{n:"Root Cellars",d:"+20% food production",food:0.20},
  hi:"Armies avoid marching through Turnipdell; soldiers keep deserting to marry farmers."},
58:{n:"Bramblehold",sp:"Pikkin",per:"defensive",gov:"council",st:[6,2,5,6,7,7,5,6,5],
  ap:"Knee-high hedge-folk in thorn-woven coats.",lg:"Pikkish (rapid chatter, six words for 'hidden')",
  cu:"A thousand burrow-villages under one tangled roof of briar.",ts:"Trap-craft and tunnel engineering.",
  str:["Impossible to occupy","Industrious","Numerous"],wk:["Tiny stature","No open-field army"],
  ab:{n:"Briar Maze",d:"+2 fortification level everywhere",fortB:2},
  hi:"Three empires have annexed Bramblehold on paper. None ever collected a single tax from it."},
59:{n:"Glassreach",sp:"Vitrix",per:"scientific",gov:"emperor",st:[8,4,6,4,2,6,4,5,5],
  ap:"Sand-lizard folk whose crystalline frills scatter the desert sun.",lg:"Vitric (chimed through frill-plates)",
  cu:"The Furnace Choir sings glass into being; a perfect pane is a holy text.",ts:"Lenses, mirrors and solar furnaces far ahead of their era.",
  str:["Solar smiths","Desert optics","Precise minds"],wk:["Brittle frills","Scarce water"],
  ab:{n:"Sun Furnace",d:"+15% energy, +5% research",energy:0.15,research:0.05},
  hi:"Glassreach lit its first solar forge while its neighbours were still arguing about flint."},
60:{n:"Lantermoss",sp:"Lampyrin",per:"peaceful",gov:"council",st:[6,2,3,6,7,5,7,7,5],
  ap:"Soft-shelled firefly-folk whose abdomens pulse with gentle gold light.",lg:"Lampyric (blink-verse)",
  cu:"Night markets lit by the shopkeepers themselves; lying dims your glow, so few bother.",ts:"Cold-light chemistry and glass lanterns.",
  str:["Living light","Honest traders","Beloved festivals"],wk:["Fragile","Winter dims them"],
  ab:{n:"Glowing Trust",d:"+2 relations from all diplomacy",dipB:2},
  hi:"Lantermoss has no walls. Attacking the village that lights the frontier's darkness is considered barbarism even by Grimmark."},
61:{n:"Driftwood",sp:"Pelicar",per:"mercantile",gov:"council",st:[5,4,4,6,5,5,7,6,6],
  ap:"Big-billed pelican-folk whose throat-pouches double as cargo holds.",lg:"Pelic (gargled harbour-song)",
  cu:"The Catch Share: every haul is divided on the beach before sundown, witnesses fed first.",ts:"Net-craft, fish-salting and harbour cranes.",
  str:["Living cargo fleets","Generous allies","Fine fishers"],wk:["Slow on land","Easily overloaded"],
  ab:{n:"Catch Share",d:"+15% food, +5% money",food:0.15,money:0.05},
  hi:"Driftwood once broke a famine two nations away by simply flying dinner over the blockade."},
62:{n:"Cormorwick",sp:"Phalacrid",per:"mercantile",gov:"council",st:[6,4,4,7,5,6,5,5,6],
  ap:"Sleek black cormorant-folk, always slightly damp, always mid-bargain.",lg:"Phalic-Corm (croaked auction chant)",
  cu:"The Dive Guilds: status is measured in depth reached and cargo raised.",ts:"Deep-diving gear and salvage winches.",
  str:["Deep divers","Salvage barons","Weatherproof"],wk:["Land-clumsy","Obsessed with wrecks"],
  ab:{n:"Salvage Guild",d:"+10% money, +10% materials",money:0.10,mat:0.10},
  hi:"Half the drowned treasure of the northern coast now decorates Cormorwick's guildhalls — catalogued, of course."},
63:{n:"Dartwood",sp:"Sablin",per:"aggressive",gov:"king",st:[6,5,4,9,5,4,4,6,5],
  ap:"Dark-furred marten-folk, quick as a rumour and twice as hard to catch.",lg:"Sablic (whispered between trees)",
  cu:"The Long Chase: honour is taken, not given, and always at a sprint.",ts:"Blowpipes, snares and tree-road networks.",
  str:["Fastest ambushers","Forest phantoms","Fearless climbers"],wk:["Slight builds","Short attention for siegework"],
  ab:{n:"Treetop Ambush",d:"+15% attack in battle",atk:0.15},
  hi:"Dartwood's border markers are simply the trees where pursuing armies gave up."},
64:{n:"Copperdell",sp:"Coboldin",per:"mercantile",gov:"council",st:[7,3,5,6,6,8,4,5,5],
  ap:"Small copper-scaled tinker-folk, singed eyebrows worn with pride.",lg:"Coboldic (workshop clatter-speech)",
  cu:"Every family forge keeps one 'beautiful failure' on the mantel as a warning and a promise.",ts:"Gadgets, gears and alarmingly experimental boilers.",
  str:["Restless inventors","Cheap manufacture","Brave testers"],wk:["Frequent explosions","Fragile"],
  ab:{n:"Tinker Guilds",d:"+15% production speed",prod:0.15},
  hi:"Copperdell sold humanity its first clockwork loom — and bought back the patents at a loss it still celebrates."},
65:{n:"Gildplume",sp:"Phasian",per:"peaceful",gov:"king",st:[5,3,3,7,6,5,8,6,4],
  ap:"Resplendent pheasant-folk trailing tail-feathers worth a farmstead each.",lg:"Phasic (courtly trills)",
  cu:"The Moult Exchange: last season's feathers are literal currency, so fashion is fiscal policy.",ts:"Dye-craft, plume-script and pageantry.",
  str:["Dazzling envoys","Wealthy courts","Famous festivals"],wk:["Vain","Hopeless soldiers"],
  ab:{n:"Feathered Court",d:"+10% money, +1 relations from diplomacy",money:0.10,dipB:1},
  hi:"Gildplume's ambassadors have never lost a negotiation they could arrive at fashionably late to."},
66:{n:"Vulturn",sp:"Gypsen",per:"defensive",gov:"council",st:[6,5,6,6,3,4,4,6,7],
  ap:"Bald-crowned vulture-folk in sun-faded funeral finery, unfailingly courteous.",lg:"Gypsic (dry rasp, drier wit)",
  cu:"The Sky Rites: nothing of the dead is wasted, and nothing of the living is rushed.",ts:"Thermal-riding, bone-craft and long patience.",
  str:["Effortless soarers","Iron stomachs","Battlefield scavengers"],wk:["Grim reputation","Slow breeders"],
  ab:{n:"Carrion Wisdom",d:"+10% materials, armies revealed",mat:0.10,vision:true},
  hi:"Vulturn arrives politely after every desert war, and somehow owns a little more of the desert each time."},
67:{n:"Miraj",sp:"Sylphid",per:"peaceful",gov:"emperor",st:[7,2,3,9,3,3,7,5,8],
  ap:"Heat-shimmer spirits wearing bodies of woven light and sand-silk.",lg:"Sylphic (heard as your own thoughts, faintly)",
  cu:"The Mirage Court holds audiences that may or may not have happened.",ts:"Illusion-craft, evaporation stills, dream-maps.",
  str:["Impossible to pin down","Mesmerising envoys","Heatproof"],wk:["Barely material","Tiny population"],
  ab:{n:"Mirage Veil",d:"+15% defence, +10% espionage",def:0.15,esp:0.10},
  hi:"Two armies have conquered Miraj's capital. Neither could find it again afterwards to garrison it."},
68:{n:"Spiralreef",sp:"Nautilim",per:"scientific",gov:"council",st:[8,3,6,3,3,5,5,6,4],
  ap:"Chambered shell-folk with clever tentacles and eyes like tide pools.",lg:"Nautic (pressure-pulse mathematics)",
  cu:"The Spiral Archive: each generation adds one chamber to the shell-library at the lagoon's heart.",ts:"Pressure vessels, buoyancy engines, slow perfect geometry.",
  str:["Deep thinkers","Living submarines","Ancient records"],wk:["Ponderous ashore","Few in number"],
  ab:{n:"Spiral Archive",d:"+15% research points",research:0.15},
  hi:"Spiralreef proved the world was round centuries ago, but filed the proof under 'obvious'."},
69:{n:"Hollyhedge",sp:"Wrennic",per:"peaceful",gov:"council",st:[6,2,2,8,8,5,7,7,5],
  ap:"Tiny wren-folk, louder than birds ten times their size, in berry-red winter caps.",lg:"Wrennish (song, exclusively)",
  cu:"Parliament is a dawn chorus; the best song becomes law until someone sings a better one.",ts:"Hedge-weaving, seed-craft and message-song relays.",
  str:["Joyful morale","Fast messengers","Everyone's darling"],wk:["Physically negligible","Laws change with the weather"],
  ab:{n:"Dawn Chorus",d:"+8 morale recovery",moraleR:8},
  hi:"Hollyhedge's anthem has forty verses, all improvised, none ever sung the same way twice."},
70:{n:"Gnarlstone",sp:"Gnomin",per:"scientific",gov:"council",st:[8,3,5,5,4,7,5,5,4],
  ap:"Knee-high gnome-folk with moss-green hoods and spectacles thick as riverbed pebbles.",lg:"Gnomish (footnoted speech)",
  cu:"The Measure of All Things: every rock, root and rainfall is surveyed, then surveyed again.",ts:"Instruments, gauges and maps accurate to the pebble.",
  str:["Precise engineers","Patient surveyors","Excellent memories"],wk:["Overthink everything","Small and slow"],
  ab:{n:"Grand Survey",d:"+10% research, +10% materials",research:0.10,mat:0.10},
  hi:"When two empires disputed a border, both hired Gnarlstone to survey it. The bill settled the war."},
71:{n:"Sunspit",sp:"Flaminel",per:"peaceful",gov:"council",st:[5,3,3,7,6,4,8,7,5],
  ap:"Rose-pink flamingo-folk who conduct all diplomacy standing on one leg.",lg:"Flamic (elegant honking)",
  cu:"The Lagoon Ballet: politics, courtship and exercise are the same choreographed event.",ts:"Salt-harvesting and brine-chemistry.",
  str:["Graceful envoys","Salt wealth","Unflappable"],wk:["Top-heavy soldiers","Blush visibly when lying"],
  ab:{n:"Salt Pans",d:"+10% money, +5% food",money:0.10,food:0.05},
  hi:"Sunspit's peace accords are danced, not signed. They have never once been broken — nobody remembers the steps well enough to violate them."},
72:{n:"Skerrywick",sp:"Fratercul",per:"defensive",gov:"council",st:[5,4,5,7,6,5,5,7,5],
  ap:"Stout puffin-folk with painted bills and absolutely no fear of cliffs.",lg:"Fraterc (cheerful gargling)",
  cu:"Burrow-villages in the sea-cliffs; every family owns three fish-knives and one very good story.",ts:"Cliff-craft, cold-water fishing, storm-cellars.",
  str:["Cliff fortresses","Hardy sailors","High spirits"],wk:["Tiny nation","Waddle on land"],
  ab:{n:"Cliff Burrows",d:"+1 fortification, +10% food",fortB:1,food:0.10},
  hi:"Raiders once scaled Skerrywick's cliffs at night. The puffins still tell the story at every feast; the raiders tell no stories at all."},
73:{n:"Turtlecove",sp:"Chelonai",per:"defensive",gov:"council",st:[6,4,8,2,4,5,6,6,5],
  ap:"Barnacled sea-turtle folk who remember the coastline before the mountains moved.",lg:"Chelic (tide-slow ballads)",
  cu:"The Long Return: every citizen sails the world once, then comes home forever.",ts:"Current-charts older than most nations.",
  str:["Ocean navigators","Armoured shells","Deep memory"],wk:["Extremely slow","Rare hatchings"],
  ab:{n:"Ancient Currents",d:"+15% defence, coastal attacks unlocked early",def:0.15,earlyNavy:true},
  hi:"Turtlecove's eldest citizen has personally met the founders of four other nations. She thought little of them."},
74:{n:"Farrock",sp:"Albatryn",per:"peaceful",gov:"council",st:[7,3,4,8,2,4,6,6,6],
  ap:"Great white albatross-folk who measure distance in weeks and friendship in decades.",lg:"Albic (spoken only over open water)",
  cu:"The Far Watch: one lighthouse, one library, and the patience of the open sea.",ts:"Long-range gliding and celestial navigation.",
  str:["Unmatched range","Storm-riders","Serene wisdom"],wk:["Handful of citizens","Hate crowds"],
  ab:{n:"Far Sight",d:"Enemy armies always revealed",vision:true},
  hi:"Farrock's lighthouse has guided every fleet in the eastern sea home at least once. Its keepers have declined every medal."},
};

// ---------------- TECHNOLOGIES ----------------
// cat: MIL ECO EDU SCI MED GOV ENE SPA
// eff keys: food/mat/money/energy/research/prod (multipliers +x),
// growth, atk/def, fort, esp, counterEsp, stab, moraleB, navy(1=coastal attacks),
// unlockB:'bldgId', unlockU:'unitId', vision, occup
const TECHS = [
 // ---- Era 1: Primitive (9) ----
 {id:"stone_tools",   e:1,cat:"ECO",c:30, req:[],n:"Stone Tools",d:"+10% materials",eff:{mat:0.10}},
 {id:"fire",          e:1,cat:"ENE",c:30, req:[],n:"Fire Mastery",d:"+10% energy, +2 morale",eff:{energy:0.10,moraleB:2}},
 {id:"agriculture",   e:1,cat:"ECO",c:40, req:[],n:"Agriculture",d:"Unlocks Farm",eff:{unlockB:"farm"}},
 {id:"hunting",       e:1,cat:"MIL",c:35, req:[],n:"Hunting Bands",d:"+5% food, unlocks Slinger",eff:{food:0.05,unlockU:"slinger"}},
 {id:"tribal_council",e:1,cat:"GOV",c:40, req:[],n:"Tribal Council",d:"+5 stability",eff:{stab:5}},
 {id:"shelter",       e:1,cat:"ECO",c:35, req:[],n:"Shelter Building",d:"Unlocks House",eff:{unlockB:"house"}},
 {id:"herbal",        e:1,cat:"MED",c:40, req:[],n:"Herbal Medicine",d:"+5% population growth",eff:{growth:0.05}},
 {id:"oral",          e:1,cat:"EDU",c:35, req:[],n:"Oral Tradition",d:"+5% research",eff:{research:0.05}},
 {id:"rafts",         e:1,cat:"MIL",c:45, req:[],n:"Sailing Rafts",d:"Attack coastal neighbours across water, unlocks Raft (1-unit ferry)",eff:{navy:1,unlockU:"raft"}},
 // ---- Era 2: Ancient (9) ----
 {id:"bronze",        e:2,cat:"MIL",c:80, req:["stone_tools"],n:"Bronze Working",d:"Unlocks Spearman, +5% attack",eff:{unlockU:"spearman",atk:0.05}},
 {id:"writing",       e:2,cat:"EDU",c:80, req:["oral"],n:"Writing",d:"Unlocks School",eff:{unlockB:"school"}},
 {id:"masonry",       e:2,cat:"MIL",c:85, req:["stone_tools"],n:"Masonry",d:"+1 fortification level",eff:{fort:1}},
 {id:"wheel",         e:2,cat:"ECO",c:80, req:[],n:"The Wheel",d:"+10% production speed",eff:{prod:0.10}},
 {id:"currency",      e:2,cat:"ECO",c:90, req:[],n:"Currency",d:"+15% money income",eff:{money:0.15}},
 {id:"archery",       e:2,cat:"MIL",c:85, req:["hunting"],n:"Archery",d:"Unlocks Archer",eff:{unlockU:"archer"}},
 {id:"laws",          e:2,cat:"GOV",c:90, req:["tribal_council"],n:"Code of Laws",d:"+8 stability",eff:{stab:8}},
 {id:"irrigation",    e:2,cat:"ECO",c:85, req:["agriculture"],n:"Irrigation",d:"+15% food",eff:{food:0.15}},
 {id:"astronomy",     e:2,cat:"SCI",c:95, req:["oral"],n:"Astronomy",d:"+10% research, coastal attacks",eff:{research:0.10,navy:1}},
 // ---- Era 3: Medieval (9) ----
 {id:"iron",          e:3,cat:"MIL",c:180,req:["bronze"],n:"Iron Working",d:"Unlocks Swordsman",eff:{unlockU:"swordsman"}},
 {id:"feudalism",     e:3,cat:"GOV",c:180,req:["laws"],n:"Feudal Contracts",d:"+10% production, conscription policy",eff:{prod:0.10}},
 {id:"university",    e:3,cat:"EDU",c:200,req:["writing"],n:"Universities",d:"Unlocks University",eff:{unlockB:"university"}},
 {id:"guilds",        e:3,cat:"ECO",c:180,req:["currency"],n:"Guilds",d:"+15% money",eff:{money:0.15}},
 {id:"castles",       e:3,cat:"MIL",c:190,req:["masonry"],n:"Castles",d:"Unlocks Fortress, +1 fort",eff:{unlockB:"fortress",fort:1}},
 {id:"siegecraft",    e:3,cat:"MIL",c:190,req:["masonry"],n:"Siegecraft",d:"Unlocks Trebuchet",eff:{unlockU:"trebuchet"}},
 {id:"banking",       e:3,cat:"ECO",c:200,req:["currency"],n:"Banking",d:"+20% money",eff:{money:0.20}},
 {id:"navigation",    e:3,cat:"SCI",c:200,req:["astronomy"],n:"Navigation",d:"Attack any coastal nation",eff:{navy:2}},
 {id:"alchemy",       e:3,cat:"SCI",c:190,req:["writing"],n:"Alchemy",d:"+10% research",eff:{research:0.10}},
 // ---- Era 4: Industrial (9) ----
 {id:"gunpowder",     e:4,cat:"MIL",c:400,req:["iron","alchemy"],n:"Gunpowder",d:"Unlocks Riflemen",eff:{unlockU:"riflemen"}},
 {id:"steam",         e:4,cat:"ECO",c:420,req:["guilds"],n:"Steam Engines",d:"Unlocks Factory",eff:{unlockB:"factory"}},
 {id:"railways",      e:4,cat:"ECO",c:420,req:["steam"],n:"Railways",d:"+20% production",eff:{prod:0.20}},
 {id:"artillery_t",   e:4,cat:"MIL",c:430,req:["gunpowder"],n:"Field Artillery",d:"Unlocks Artillery",eff:{unlockU:"artillery"}},
 {id:"sanitation",    e:4,cat:"MED",c:400,req:["herbal"],n:"Sanitation",d:"Unlocks Hospital, +10% growth",eff:{unlockB:"hospital",growth:0.10}},
 {id:"printing",      e:4,cat:"EDU",c:400,req:["university"],n:"Mass Printing",d:"+15% research",eff:{research:0.15}},
 {id:"corporations",  e:4,cat:"ECO",c:430,req:["banking"],n:"Corporations",d:"+20% money",eff:{money:0.20}},
 {id:"coal",          e:4,cat:"ENE",c:420,req:["steam"],n:"Coal Power",d:"Unlocks Power Plant, +20% energy",eff:{unlockB:"power",energy:0.20}},
 {id:"conscription_t",e:4,cat:"GOV",c:410,req:["feudalism"],n:"National Service",d:"−15% unit costs",eff:{cheapUnits:0.15}},
 // ---- Era 5: Modern (10) ----
 {id:"combustion",    e:5,cat:"MIL",c:850,req:["railways"],n:"Combustion",d:"Unlocks Tank Corps",eff:{unlockU:"tanks"}},
 {id:"flight",        e:5,cat:"MIL",c:900,req:["combustion"],n:"Flight",d:"Unlocks Air Wing",eff:{unlockU:"aircraft"}},
 {id:"grid",          e:5,cat:"ENE",c:850,req:["coal"],n:"Electric Grid",d:"+30% energy",eff:{energy:0.30}},
 {id:"radio",         e:5,cat:"GOV",c:820,req:["printing"],n:"Broadcasting",d:"+5 stability, +5% espionage",eff:{stab:5,esp:0.05}},
 {id:"antibiotics",   e:5,cat:"MED",c:850,req:["sanitation"],n:"Antibiotics",d:"+15% growth",eff:{growth:0.15}},
 {id:"assembly",      e:5,cat:"ECO",c:880,req:["railways"],n:"Assembly Lines",d:"+25% production",eff:{prod:0.25}},
 {id:"education",     e:5,cat:"EDU",c:850,req:["printing"],n:"Universal Education",d:"+20% research",eff:{research:0.20}},
 {id:"agencies",      e:5,cat:"GOV",c:870,req:["radio"],n:"Intelligence Agencies",d:"+15% espionage, +10% counterespionage",eff:{esp:0.15,counterEsp:0.10}},
 {id:"oil",           e:5,cat:"ENE",c:880,req:["combustion"],n:"Oil Refining",d:"+20% energy, +10% money",eff:{energy:0.20,money:0.10}},
 {id:"rocketry",      e:5,cat:"MIL",c:900,req:["artillery_t"],n:"Rocketry",d:"Unlocks Missile Silo & ballistic missiles",eff:{unlockB:"silo"}},
 // ---- Era 6: Information (12) ----
 {id:"computers",     e:6,cat:"SCI",c:1700,req:["education"],n:"Computers",d:"Unlocks Laboratory, +15% research",eff:{unlockB:"lab",research:0.15}},
 {id:"internet",      e:6,cat:"SCI",c:1750,req:["computers"],n:"Global Network",d:"+15% research, +10% espionage",eff:{research:0.15,esp:0.10}},
 {id:"satellites",    e:6,cat:"SPA",c:1800,req:["computers"],n:"Satellites",d:"All enemy armies revealed",eff:{vision:1}},
 {id:"precision",     e:6,cat:"MIL",c:1800,req:["flight"],n:"Precision Weapons",d:"Unlocks Missile Battery",eff:{unlockU:"missiles"}},
 {id:"genetics",      e:6,cat:"MED",c:1750,req:["antibiotics"],n:"Genetics",d:"+15% growth",eff:{growth:0.15}},
 {id:"nuclear",       e:6,cat:"ENE",c:1850,req:["grid"],n:"Nuclear Power",d:"+40% energy",eff:{energy:0.40}},
 {id:"markets",       e:6,cat:"ECO",c:1750,req:["corporations"],n:"Global Markets",d:"+25% money",eff:{money:0.25}},
 {id:"cybersec",      e:6,cat:"GOV",c:1700,req:["internet"],n:"Cyber Security",d:"+25% counterespionage",eff:{counterEsp:0.25}},
 {id:"robotics",      e:6,cat:"ECO",c:1850,req:["computers"],n:"Robotics",d:"+30% production, unlocks Drone Corps",eff:{prod:0.30,unlockU:"drones"}},
 {id:"guidance",      e:6,cat:"MIL",c:1800,req:["rocketry","computers"],n:"Guidance Systems",d:"Unlocks homing missiles",eff:{}},
 {id:"nukes",         e:6,cat:"MIL",c:1950,req:["rocketry","nuclear"],n:"Nuclear Weapons",d:"Unlocks nuclear missiles — the last argument",eff:{}},
 {id:"abm",           e:6,cat:"MIL",c:1850,req:["guidance"],n:"Missile Defence",d:"Unlocks Anti-Missile Battery (45% interception)",eff:{unlockB:"abm"}},
 // ---- Era 7: Futuristic (10) ----
 {id:"ai",            e:7,cat:"SCI",c:3400,req:["internet"],n:"AI Cores",d:"+30% research",eff:{research:0.30}},
 {id:"energyweapons", e:7,cat:"MIL",c:3600,req:["ai"],n:"Energy Weapons",d:"Unlocks Plasma Legion",eff:{unlockU:"plasma"}},
 {id:"exosuits",      e:7,cat:"MIL",c:3500,req:["robotics"],n:"Powered Exosuits",d:"Species strength weakness overcome (+20% attack & defence)",eff:{atk:0.20,def:0.20}},
 {id:"fusion",        e:7,cat:"ENE",c:3600,req:["nuclear"],n:"Fusion Power",d:"+50% energy",eff:{energy:0.50}},
 {id:"nanomed",       e:7,cat:"MED",c:3400,req:["genetics"],n:"Nanomedicine",d:"+20% growth",eff:{growth:0.20}},
 {id:"orbitaldef",    e:7,cat:"SPA",c:3600,req:["satellites"],n:"Orbital Defence",d:"+2 fortification",eff:{fort:2}},
 {id:"quantum",       e:7,cat:"SCI",c:3500,req:["ai"],n:"Quantum Networks",d:"+15% research, +15% espionage",eff:{research:0.15,esp:0.15}},
 {id:"autofactories", e:7,cat:"ECO",c:3600,req:["robotics"],n:"Autonomous Factories",d:"+40% production",eff:{prod:0.40}},
 {id:"arcology",      e:7,cat:"ECO",c:3500,req:["autofactories"],n:"Arcologies",d:"+20% food, +10% growth",eff:{food:0.20,growth:0.10}},
 {id:"lasershield",   e:7,cat:"MIL",c:3500,req:["abm","energyweapons"],n:"Laser Shield",d:"Anti-missile interception improves to 75%",eff:{}},
 // ---- Era 8: Interplanetary (8) ----
 {id:"shipyards",     e:8,cat:"SPA",c:7000,req:["orbitaldef"],n:"Orbital Shipyards",d:"Unlocks Star Fleet",eff:{unlockU:"starfleet"}},
 {id:"fusiondrives",  e:8,cat:"SPA",c:7200,req:["fusion"],n:"Fusion Drives",d:"+20% production",eff:{prod:0.20}},
 {id:"terraforming",  e:8,cat:"SPA",c:7200,req:["arcology"],n:"Terraforming",d:"+30% food",eff:{food:0.30}},
 {id:"elevator",      e:8,cat:"SPA",c:7000,req:["shipyards"],n:"Space Elevator",d:"+30% money",eff:{money:0.30}},
 {id:"railguns",      e:8,cat:"MIL",c:7300,req:["energyweapons"],n:"Orbital Railguns",d:"Unlocks Railgun Platform",eff:{unlockU:"railgun"}},
 {id:"cryosleep",     e:8,cat:"MED",c:7000,req:["nanomed"],n:"Cryo-Medicine",d:"+25% growth",eff:{growth:0.25}},
 {id:"dyson",         e:8,cat:"ENE",c:7400,req:["fusion"],n:"Solar Swarm",d:"+80% energy",eff:{energy:0.80}},
 {id:"colonyships",   e:8,cat:"SPA",c:7500,req:["shipyards","terraforming"],n:"Colony Ships",d:"The stars are yours.",eff:{}},
 // ---- Era 9: Megastructure (8) — unlocks at 75% of the Interplanetary Era ----
 {id:"megaeng",       e:9,cat:"SPA",c:15000,req:["colonyships"],n:"Megastructure Engineering",d:"+25% production, opens megastructure projects in space",eff:{prod:0.25}},
 {id:"dysonsphere",   e:9,cat:"ENE",c:17000,req:["megaeng","dyson"],n:"Dyson Sphere",d:"Build a Dyson Sphere around the star (Space view)",eff:{}},
 {id:"haloring",      e:9,cat:"SPA",c:16500,req:["megaeng"],n:"Halo Rings",d:"Build Halo Ring habitats around planets (Space view)",eff:{}},
 {id:"stardestroyer_t",e:9,cat:"MIL",c:18000,req:["megaeng","railguns"],n:"Star Destroyer",d:"Unlocks the planet-killing Star Destroyer",eff:{unlockU:"stardestroyer"}},
 {id:"doomdevice",    e:9,cat:"MIL",c:25000,req:["stardestroyer_t"],n:"DOOM Device",d:"The era's hardest science: unlocks the Omni-Hypercharged Orbital Laser Strike — Harvest Stellar Energy from suns and erase entire solar systems",eff:{}},
 {id:"bhharvest_t",   e:9,cat:"ENE",c:22000,req:["dysonsphere","haloring"],n:"Black Hole Energy Harvesting",d:"Harness the galactic core: unlocks the Black Hole Energy Harvester megastructure (Space view)",eff:{}},
 {id:"voidshield",    e:9,cat:"MIL",c:16000,req:["megaeng"],n:"Void Shields",d:"+3 fortification, +20% defence — and unlocks the 🌐 Void Shield system barrier (Space view)",eff:{fort:3,def:0.20}},
 {id:"exoharvest",    e:9,cat:"ECO",c:15500,req:["megaeng"],n:"Exotic Harvesters",d:"+40% materials, +30% energy",eff:{mat:0.40,energy:0.30}},
 // ---- Space Update: deep-space engineering ----
 {id:"warp",          e:9,cat:"SPA",c:19000,req:["megaeng"],n:"Warp Drive",d:"Your ships may travel to other solar systems (Space view)",eff:{}},
 {id:"rehab_t",       e:9,cat:"SPA",c:16500,req:["megaeng"],n:"Rehabilitator",d:"Restore scorched worlds — even rebuild destroyed planets (Space view)",eff:{}},
 {id:"shield_t",      e:9,cat:"MIL",c:16500,req:["voidshield"],n:"Giant Shield",d:"Raise vast energy barriers around planets and megastructures (Space view)",eff:{}},
 {id:"researcher_t",  e:9,cat:"SCI",c:16000,req:["megaeng"],n:"Researcher Station",d:"A city-sized research megastructure in open space (Space view)",eff:{}},
 // BUG REPORT: Phantom Step is a real research now — the cloak itself. Using it
 // still needs a 🌆 Researcher completed as a 🔭 Deep Space Research Station.
 {id:"phantom_t",     e:9,cat:"SPA",c:20000,req:["researcher_t"],n:"Phantom Step",d:"Fold light and signal around an entire solar system, hiding it from the galaxy — activated from a 🔭 Deep Space Research Station (Space view)",eff:{}},
];

// ---------------- UNITS ----------------
// melee units scale with Strength; ranged/vehicles with Agility then Intelligence in later eras
// icon: shown in the army box on the map
// spd: map movement (px/s) · rng: attack range (px) · vis: vision radius at war (px)
// naval:1 = ship (water-only, built by coastal cities) · cap: transport troop capacity
// air:1 = flying unit — crosses land and water freely, never uses transport ships
// Part 12 (AI Improvements): cd = attack cooldown seconds (units now differ),
// dmgMul = per-shot damage scale for fast-firing units, splash = area damage
// radius, sec = secondary weapon {f: fraction of main damage, cd, rng},
// sdGround = the main gun one-shots ground troops (Star Destroyer)
const UNITS = {
 club:      {n:"Club Warriors",  icon:"🪵",e:1,atk:3, def:2, hp:10, melee:1,spd:24,rng:8,  vis:60, cost:{money:25,mat:5},  up:1,  tech:null,cd:1.1},
 slinger:   {n:"Slingers",       icon:"🪨",e:1,atk:4, def:1, hp:8,  melee:0,spd:24,rng:28, vis:80, cost:{money:30,mat:8},  up:1,  tech:"hunting",cd:1.7},
 guard:     {n:"Tribal Guard",   icon:"🛡️",e:1,atk:2, def:4, hp:12, melee:1,spd:20,rng:8,  vis:60, cost:{money:30,mat:8},  up:1,  tech:null,cd:1.3},
 // raft: earliest naval transport — carries ONE unit of era 1-2, needs only a coastal city (no port)
 raft:      {n:"Raft",           icon:"🛶",e:1,atk:1, def:2, hp:8,  melee:0,spd:26,rng:6,  vis:70, cost:{money:40,mat:20}, up:1,  tech:"rafts",naval:1,cap:1,raft:1,cargoEraMax:2,cd:2.0},
 spearman:  {n:"Spearmen",       icon:"🔱",e:2,atk:6, def:6, hp:18, melee:1,spd:23,rng:9,  vis:70, cost:{money:55,mat:15}, up:2,  tech:"bronze",cd:1.2},
 archer:    {n:"Archers",        icon:"🏹",e:2,atk:8, def:3, hp:14, melee:0,spd:23,rng:40, vis:95, cost:{money:60,mat:18}, up:2,  tech:"archery",cd:1.6},
 chariot:   {n:"War Chariots",   icon:"🐎",e:2,atk:9, def:4, hp:16, melee:1,spd:40,rng:9,  vis:90, cost:{money:80,mat:25}, up:3,  tech:null,cd:1.0},
 swordsman: {n:"Swordsmen",      icon:"⚔️",e:3,atk:12,def:10,hp:30, melee:1,spd:23,rng:9,  vis:75, cost:{money:110,mat:35},up:4,  tech:"iron",cd:1.1},
 crossbow:  {n:"Crossbowmen",    icon:"🎯",e:3,atk:14,def:6, hp:22, melee:0,spd:21,rng:46, vis:100,cost:{money:120,mat:40},up:4,  tech:null,cd:2.0},
 trebuchet: {n:"Trebuchets",     icon:"🏗️",e:3,atk:18,def:3, hp:20, melee:0,spd:13,rng:72, vis:110,cost:{money:170,mat:70},up:6,  tech:"siegecraft",cd:3.4,splash:12},
 galley:    {n:"War Galleys",    icon:"⛵",e:3,atk:14,def:8, hp:26, melee:0,spd:34,rng:44, vis:110,cost:{money:150,mat:60},up:5,  tech:"navigation",naval:1,cd:1.8},
 transport: {n:"Transport Ship", icon:"⛴️",e:3,atk:2, def:6, hp:30, melee:0,spd:30,rng:10, vis:100,cost:{money:130,mat:70},up:4,  tech:"navigation",naval:1,cap:4,cd:2.2},
 riflemen:  {n:"Riflemen",       icon:"🔫",e:4,atk:24,def:18,hp:50, melee:0,spd:25,rng:50, vis:110,cost:{money:220,mat:80},up:8,  tech:"gunpowder",cd:1.4},
 artillery: {n:"Artillery",      icon:"💣",e:4,atk:34,def:6, hp:35, melee:0,spd:15,rng:100,vis:155,cost:{money:320,mat:130},up:12, tech:"artillery_t",cd:3.2,splash:18},
 grenadier: {n:"Grenadiers",     icon:"🧨",e:4,atk:28,def:14,hp:45, melee:0,spd:23,rng:42, vis:105,cost:{money:260,mat:100},up:10, tech:null,cd:1.6,splash:10},
 frigate:   {n:"Frigates",       icon:"🛥️",e:4,atk:30,def:16,hp:55, melee:0,spd:38,rng:70, vis:140,cost:{money:340,mat:150},up:12, tech:"gunpowder",naval:1,cd:2.0},
 tanks:     {n:"Tank Corps",     icon:"🚜",e:5,atk:55,def:40,hp:110,melee:0,spd:42,rng:56, vis:130,cost:{money:520,mat:220,energy:30},up:20,tech:"combustion",cd:1.7,sec:{f:0.22,cd:0.5,rng:32}},
 aircraft:  {n:"Air Wing",       icon:"✈️",e:5,atk:70,def:20,hp:80, melee:0,spd:75,rng:70, vis:200,cost:{money:650,mat:260,energy:50},up:26,tech:"flight",air:1,cd:1.1},
 mechinf:   {n:"Mech. Infantry", icon:"🪖",e:5,atk:45,def:45,hp:120,melee:0,spd:35,rng:52, vis:120,cost:{money:480,mat:190,energy:25},up:18,tech:null,cd:1.4,sec:{f:0.3,cd:0.6,rng:28}},
 destroyer: {n:"Destroyers",     icon:"🚢",e:5,atk:60,def:35,hp:120,melee:0,spd:46,rng:85, vis:170,cost:{money:700,mat:300,energy:40},up:24,tech:"combustion",naval:1,cd:2.0,sec:{f:0.25,cd:0.6,rng:45}},
 drones:    {n:"Drone Corps",    icon:"🛸",e:6,atk:95, def:55, hp:150,melee:0,spd:62,rng:78, vis:185,cost:{money:1000,mat:420,energy:120},up:38,tech:"robotics",air:1,cd:0.8,dmgMul:0.5},
 missiles:  {n:"Missile Battery",icon:"🚀",e:6,atk:130,def:25, hp:120,melee:0,spd:18,rng:150,vis:175,cost:{money:1300,mat:560,energy:170},up:50,tech:"precision",cd:3.6,splash:22},
 cyberops:  {n:"Cyber Commandos",icon:"💻",e:6,atk:85, def:75, hp:170,melee:0,spd:32,rng:56, vis:145,cost:{money:950,mat:380,energy:100},up:35,tech:null,cd:1.2},
 cruiser:   {n:"Missile Cruisers",icon:"🛳️",e:6,atk:120,def:60,hp:180,melee:0,spd:44,rng:150,vis:200,cost:{money:1500,mat:640,energy:180},up:55,tech:"precision",naval:1,cd:2.6,splash:14,sec:{f:0.2,cd:0.7,rng:60}},
 plasma:    {n:"Plasma Legion",  icon:"🔆",e:7,atk:200,def:120,hp:280,melee:0,spd:42,rng:88, vis:185,cost:{money:2100,mat:900,energy:350},up:75,tech:"energyweapons",cd:1.6},
 exocorps:  {n:"Exosuit Corps",  icon:"🤖",e:7,atk:160,def:170,hp:340,melee:1,spd:38,rng:14, vis:155,cost:{money:1900,mat:800,energy:300},up:68,tech:null,cd:1.0},
 hover:     {n:"Hover Armour",   icon:"🚁",e:7,atk:180,def:140,hp:300,melee:0,spd:58,rng:72, vis:175,cost:{money:2000,mat:860,energy:330},up:70,tech:null,air:1,cd:0.9,dmgMul:0.55},
 starfleet: {n:"Star Fleet",     icon:"🛰️",e:8,atk:420,def:280,hp:600,melee:0,spd:68,rng:175,vis:260,cost:{money:4500,mat:1900,energy:900},up:150,tech:"shipyards",air:1,space:1,cd:0.7,dmgMul:0.3,sec:{f:0.5,cd:0.45,rng:80}},
 railgun:   {n:"Railgun Platform",icon:"⚡",e:8,atk:520,def:180,hp:500,melee:0,spd:22,rng:195,vis:225,cost:{money:5200,mat:2200,energy:1100},up:170,tech:"railguns",air:1,cd:3.0,splash:16,sec:{f:0.15,cd:0.7,rng:70}},
 orbmarines:{n:"Orbital Marines",icon:"👾",e:8,atk:360,def:340,hp:700,melee:1,spd:47,rng:16, vis:185,cost:{money:4200,mat:1800,energy:850},up:140,tech:null,air:1,cd:0.9},
 // space:1 — can launch into orbit from a city with a Space Program (see space.js)
 rocket:    {n:"Cargo Rocket",   icon:"🚀",e:8,atk:8,  def:30, hp:180,melee:0,spd:40,rng:10, vis:120,cost:{money:900,mat:400,energy:120},up:30, tech:"shipyards",air:1,space:1,cap:2,cd:2.0},
 cargoship: {n:"Cargo Spacecraft",icon:"🛸",e:8,atk:20, def:80, hp:320,melee:0,spd:44,rng:12, vis:150,cost:{money:2600,mat:1100,energy:400},up:80, tech:"colonyships",air:1,space:1,cap:6,cd:2.2},
 stardestroyer:{n:"Star Destroyer",icon:"🌠",e:9,atk:1500,def:600,hp:2500,melee:0,spd:30,rng:200,vis:300,cost:{money:30000,mat:12000,energy:5000},up:500,tech:"stardestroyer_t",air:1,space:1,slow:20,big:1,cd:4.5,splash:40,sdGround:1,sec:{f:0.06,cd:0.6,rng:120}},
};

// ---------------- BUILDINGS ----------------
const BLDGS = {
 house:   {n:"Houses",       icon:"🏠",cost:{money:60, mat:25}, d:"+0.35 population capacity",           tech:"shelter"},
 farm:    {n:"Farm",         icon:"🌾",cost:{money:70, mat:20}, d:"+6 food",                             tech:"agriculture"},
 mine:    {n:"Mine",         icon:"⛏", cost:{money:90, mat:30}, d:"+5 materials",                        tech:null},
 factory: {n:"Factory",      icon:"🏭",cost:{money:260,mat:120},d:"+12 materials, +8 money (needs 5 energy)",tech:"steam"},
 // Part 14 (AI Improvements): the expanded material production chain
 refinery:{n:"Refinery",     icon:"⚗️",cost:{money:340,mat:150},d:"+9 materials — refined output, +25% with a Mine in the city (needs 3 energy)",tech:"steam"},
 industrial:{n:"Industrial Plant",icon:"🏗",cost:{money:520,mat:240},d:"+18 materials, +6 money (needs 6 energy, high upkeep)",tech:"assembly"},
 megafactory:{n:"Mega Factory",icon:"🏙",cost:{money:2400,mat:1100},d:"+60 materials, +25 money (needs 20 energy, very high upkeep)",tech:"autofactories"},
 school:  {n:"School",       icon:"📖",cost:{money:120,mat:40}, d:"+3 research",                         tech:"writing"},
 university:{n:"University", icon:"🎓",cost:{money:300,mat:110},d:"+8 research",                         tech:"university"},
 lab:     {n:"Laboratory",   icon:"🔬",cost:{money:700,mat:260},d:"+20 research (needs 8 energy)",       tech:"computers"},
 hospital:{n:"Hospital",     icon:"🏥",cost:{money:280,mat:100},d:"+8% growth, +1 morale",               tech:"sanitation"},
 base:    {n:"Military Base",icon:"🎖", cost:{money:220,mat:90}, d:"−10% unit upkeep, +5% defence",       tech:null},
 fortress:{n:"Fortress",     icon:"🛡", cost:{money:240,mat:130},d:"+1 fortification level",              tech:"castles"},
 power:   {n:"Power Plant",  icon:"⚡",cost:{money:320,mat:140},d:"+15 energy",                          tech:"coal"},
 // income buildings — simple flat money per turn, unlocking across the eras
 market:  {n:"Market",       icon:"🧺",cost:{money:120,mat:40}, d:"+6 money",                            tech:"currency"},
 taxoffice:{n:"Tax Office",  icon:"🏛",cost:{money:150,mat:50}, d:"+8 money",                            tech:"laws"},
 tradehub:{n:"Trade Centre", icon:"🏪",cost:{money:240,mat:90}, d:"+12 money",                           tech:"guilds"},
 port:    {n:"Port",         icon:"⚓",cost:{money:280,mat:120},d:"+10 money, +4 food (coastal cities only)",tech:"navigation",coastal:1},
 bank:    {n:"Bank",         icon:"🏦",cost:{money:400,mat:140},d:"+20 money",                           tech:"banking"},
 commerce:{n:"Commercial District",icon:"🏙",cost:{money:700,mat:260},d:"+32 money",                     tech:"corporations"},
 // strategic buildings
 silo:    {n:"Missile Silo", icon:"🚀",cost:{money:500,mat:250},d:"Build & launch missiles from this city",tech:"rocketry"},
 abm:     {n:"Anti-Missile Battery",icon:"🛰",cost:{money:600,mat:280},d:"45% chance to intercept missiles aimed near this city (75% with Laser Shield)",tech:"abm"},
 spaceprogram:{n:"Space Program",icon:"🚀",cost:{money:3200,mat:1400},d:"Launch site: build spacecraft here and send them into space (needs spare energy per launch)",tech:"shipyards"},
};

// ---------------- POLICIES ----------------
const POLICIES = {
 tax:    {n:"Tax Level",       opts:["Low","Medium","High"],     d:["+4 morale, −30% taxes","balanced","+40% taxes, −6 morale"]},
 edu:    {n:"Education Budget",opts:["Low","Medium","High"],     d:["−15% research, +10% money","balanced","+20% research, −12% money"]},
 mil:    {n:"Military Budget", opts:["Low","Medium","High"],     d:["−25% upkeep, −10% army power","balanced","+15% army power, +30% upkeep"]},
 health: {n:"Healthcare",      opts:["Low","Medium","High"],     d:["−10% growth, +8% money","balanced","+15% growth, −10% money"]},
 trade:  {n:"Trade Policy",    opts:["Closed","Open"],           d:["+10% materials, −15% money, −1 relations drift","+15% money, +1 relations drift"]},
 consc:  {n:"Conscription",    opts:["Off","On"],                d:["no effect","−25% recruit cost, −4 morale"]},
};

// ---------------- EVENTS ----------------
const EVENTS = [
 {id:"ore",   n:"Rich Ore Vein Discovered", d:"Surveyors report a rich vein in {prov}.",
  ch:[{t:"Mine it fully (+250 materials)",eff:{mat:250}},{t:"Sell the claim (+200 money)",eff:{money:200}}]},
 {id:"famine",n:"Poor Harvest",d:"Blight has ruined crops across {prov}.",
  ch:[{t:"Buy foreign grain (−150 money)",eff:{money:-150}},{t:"Let the people endure (−8 morale, −pop)",eff:{morale:-8,pop:-0.2}}]},
 {id:"eureka",n:"Scientific Breakthrough",d:"A researcher in {prov} makes an unexpected leap.",
  ch:[{t:"Fund the work (+120 research, −80 money)",eff:{rp:120,money:-80}},{t:"Applaud politely (+40 research)",eff:{rp:40}}]},
 {id:"protest",n:"Protests in the Streets",d:"Crowds demand change in {prov}.",
  ch:[{t:"Listen and reform (+6 morale, −120 money)",eff:{morale:6,money:-120}},{t:"Disperse them (−6 morale, +4 stability)",eff:{morale:-6,stab:4}}]},
 {id:"quake", n:"Natural Disaster",d:"An earthquake strikes {prov}.",
  ch:[{t:"Full relief effort (−200 money, +4 morale)",eff:{money:-200,morale:4}},{t:"Minimal aid (−6 morale, −100 materials)",eff:{morale:-6,mat:-100}}]},
 {id:"offer", n:"Foreign Goodwill",d:"{other} sends a ceremonial delegation.",
  ch:[{t:"Host them lavishly (−80 money, +12 relations)",eff:{money:-80,rel:12}},{t:"Receive them briefly (+4 relations)",eff:{rel:4}}]},
 {id:"plague",n:"Outbreak",d:"Disease spreads through {prov}.",
  ch:[{t:"Quarantine and treat (−150 money)",eff:{money:-150}},{t:"Hope it passes (−pop, −5 morale)",eff:{pop:-0.3,morale:-5}}]},
 {id:"refugees",n:"Refugees Arrive",d:"Families displaced by distant wars reach the border.",
  ch:[{t:"Welcome them (+pop, −3 stability)",eff:{pop:0.3,stab:-3}},{t:"Turn them away (−3 morale)",eff:{morale:-3}}]},
 {id:"festival",n:"Folk Festival",d:"The people ask leave for a grand festival.",
  ch:[{t:"Sponsor it (−100 money, +8 morale)",eff:{money:-100,morale:8}},{t:"Decline (no effect)",eff:{}}]},
 {id:"deserters",n:"Border Incident",d:"Soldiers clashed with a patrol from {other}.",
  ch:[{t:"Apologise formally (−60 money, +4 relations)",eff:{money:-60,rel:4}},{t:"Stand firm (−8 relations)",eff:{rel:-8}}]},
];

// human-only lore events — relics of the empire that fell before the Long Sleep
const HUMAN_EVENTS = [
 {id:"h_capsule",n:"Ancient Escape Capsule",d:"Excavators in {prov} uncover a corroded escape capsule from before the Long Sleep — its data core still hums.",
  ch:[{t:"Decrypt the core (+180 research)",eff:{rp:180}},{t:"Sell the strange alloys (+220 money)",eff:{money:220}}]},
 {id:"h_records",n:"Damaged Records",d:"A sealed vault of pre-Sleep records opens beneath {prov}. Most is ash — but not all.",
  ch:[{t:"Restore the archives (−120 money, +140 research)",eff:{money:-120,rp:140}},{t:"Seal it again — some doors should stay shut (+4 stability)",eff:{stab:4}}]},
 {id:"h_signal",n:"A Signal From Before",d:"A dead relay far above briefly wakes and repeats one phrase in Old Terran: 'Remember us.'",
  ch:[{t:"Broadcast it to the nation (+6 morale)",eff:{morale:6}},{t:"Classify it and study the relay (+60 research)",eff:{rp:60}}]},
];

// ---------------- MISSILES ----------------
// Launched from a city with a Missile Silo. See war.js for flight & impact.
const MISSILE_TYPES = {
 ballistic:{n:"Ballistic Missile",icon:"🚀",tech:"rocketry",cost:{money:700,mat:300},dmg:260,radius:38,spd:170,
   d:"Heavy damage in a small area — hurts armies, buildings and cities."},
 homing:   {n:"Homing Missile",  icon:"🛰️",tech:"guidance",cost:{money:900,mat:380},dmg:220,radius:26,spd:150,homing:true,
   d:"Locks onto an enemy army and tracks it; smaller blast."},
 nuke:     {n:"Nuclear Missile", icon:"☢️",tech:"nukes",cost:{money:4500,mat:1800},dmg:1500,radius:85,spd:140,nuke:true,
   d:"Massive area damage. Can destroy a weak or unprotected city outright. Severe diplomatic consequences."},
};
const ABM_BASE_CHANCE = 0.45, ABM_LASER_CHANCE = 0.75;

// Small Update §10 + BUG REPORT (research progression): technology is a long
// road in EVERY era, not only the last one. The old table barely touched the
// early game (Stone Tools still cost ~30 RP) — these multipliers bake into the
// real per-tech costs below at load, so the tree display, research progress,
// AI, aliens and multiplayer all use the same heavier numbers. Target ranges:
// Primitive 100-300 · Ancient 300-800 · Medieval 800-2000 · Industrial 2-5k ·
// Modern 5-12k · Information 12-30k · Futuristic 30-75k · Interplanetary
// 75-200k · Megastructure 200k+. The 75% era-unlock rule is untouched — the
// slower march comes purely from the costs.
const TECH_ERA_COST_MULT = [null, 4.5, 5, 6, 7, 8, 10, 12, 14, 15];
TECHS.forEach(t => { t.c = Math.round(t.c * (TECH_ERA_COST_MULT[t.e] || 1)); });

const FLAG_GLYPHS = ["★","☀","☾","⚔","🜲","✦","❖","▲","⬢","☘","♆","✕","◉","♜"];

// ---------------- COUNTRY MERGES ----------------
// build_map.cs split some drawn countries along dark terrain, and a few tiny
// splinters belong together. Each group merges into its FIRST member at load.
// This is a runtime remap — mapdata.js itself is never edited.
const COUNTRY_MERGES = [
  [5, 49, 58],   // Verdanth absorbs Elowen & Bramblehold
  [12, 15],      // Korrahl absorbs Skyreach
  [18, 57, 69],  // Maruw absorbs Turnipdell & Hollyhedge
];
const MERGE_TARGET = {}; // absorbedId -> survivorId
COUNTRY_MERGES.forEach(g => { for (let i = 1; i < g.length; i++) MERGE_TARGET[g[i]] = g[0]; });
function mergedId(id) { return MERGE_TARGET[id] || id; }

// fold absorbed entries into their survivor inside MAP_META (bbox, area, biome
// fractions, neighbour graph). Runs once at script load, before any game state.
(function applyCountryMerges() {
  const byId = {};
  for (const m of MAP_META.countries) byId[m.id] = m;
  for (const g of COUNTRY_MERGES) {
    const t = byId[g[0]];
    if (!t) continue;
    for (let i = 1; i < g.length; i++) {
      const s = byId[g[i]];
      if (!s) continue;
      const at = t.area, as = s.area, sum = at + as;
      t.bbox = [Math.min(t.bbox[0], s.bbox[0]), Math.min(t.bbox[1], s.bbox[1]),
                Math.max(t.bbox[2], s.bbox[2]), Math.max(t.bbox[3], s.bbox[3])];
      t.snow = (t.snow * at + s.snow * as) / sum;
      t.sand = (t.sand * at + s.sand * as) / sum;
      t.green = (t.green * at + s.green * as) / sum;
      t.area = sum;
      t.coastal = t.coastal || s.coastal;
      t.human = t.human || s.human;
      for (const nb of s.neighbors) if (!t.neighbors.includes(nb)) t.neighbors.push(nb);
      delete byId[g[i]];
    }
  }
  MAP_META.countries = Object.keys(byId).map(k => byId[k]).sort((a, b) => a.id - b.id);
  for (const m of MAP_META.countries) {
    const seen = {};
    const nbs = [];
    for (const nb of m.neighbors) {
      const t = mergedId(nb);
      if (t !== m.id && !seen[t]) { seen[t] = 1; nbs.push(t); }
    }
    m.neighbors = nbs.sort((a, b) => a - b);
  }
})();

const CAT_NAMES = {MIL:"Military",ECO:"Economy",EDU:"Education",SCI:"Science",MED:"Medicine",GOV:"Government",ENE:"Energy",SPA:"Space"};
const CAT_COLORS = {MIL:"#ff5468",ECO:"#f0a848",EDU:"#4fd6ff",SCI:"#b48cff",MED:"#5ce0a2",GOV:"#e8d56a",ENE:"#ff9a3c",SPA:"#7fa8ff"};

// ---------------- SPACE (Part 2: the Space Expansion) ----------------
// The solar system: the Homeworld carries the whole 2D map; the other planets
// are colonizable from the Space view (see space.js).
const SPACE_STAR = { n: "Aurelia", r: 46, col: [255, 220, 120] };
// Multiple solar systems (Space Update Part 5). "home" is the original system;
// the others hold colonizable worlds and alien civilizations. Travelling to a
// foreign system requires the Warp Drive technology.
// Space Update 2 Part 6: these are only the AUTHORED systems. Each new game
// generates ~50 total (genGalaxy in space.js); the generated defs live in
// G.space.gen and are merged into the runtime SPACE_SYSTEMS / SPACE_PLANETS
// arrays by rebuildGalaxy() — never push into the BASE arrays directly.
const SPACE_SYSTEMS_BASE = [
 {id:"home", n:"Aurelia",  x:0,     z:0,     r:46, col:[255,220,120]},
 {id:"vex",  n:"Vexis",    x:-3400, z:-2100, r:40, col:[255,150,110]},
 {id:"zer",  n:"Zeruul",   x:3600,  z:-1500, r:52, col:[150,190,255]},
 {id:"kae",  n:"Kaelis",   x:900,   z:3800,  r:36, col:[255,235,190]},
];
const SPACE_PLANETS_BASE = [
 {id:"home",  n:"The Homeworld", type:"main", r:26, dist:210, ang:0.6, speed:0.010, col:[86,160,220],  col2:[70,190,120]},
 {id:"cinder",n:"Cinderis",      type:"lava", r:13, dist:120, ang:2.4, speed:0.020, col:[235,110,60],  col2:[120,40,20],  bias:"mat"},
 {id:"rubra", n:"Rubra",         type:"rock", r:16, dist:300, ang:4.2, speed:0.008, col:[200,120,90],  col2:[130,70,50],  bias:null},
 {id:"glaci", n:"Glacius",       type:"ice",  r:15, dist:390, ang:1.5, speed:0.006, col:[190,220,245], col2:[120,160,200],bias:"research"},
 {id:"velor", n:"Veloria",       type:"gas",  r:24, dist:500, ang:3.3, speed:0.004, col:[220,190,130], col2:[170,130,80], bias:"energy", ring:1},
 {id:"nyx",   n:"Nyx",           type:"dark", r:11, dist:600, ang:5.4, speed:0.003, col:[120,110,150], col2:[70,60,95],   bias:"money"},
 // --- foreign systems (Space Update Part 5) ---
 {id:"vex1", n:"Ashfall",  sys:"vex", type:"lava", r:14, dist:150, ang:1.1, speed:0.014, col:[240,120,70],  col2:[130,45,25],  bias:"mat"},
 {id:"vex2", n:"Duskhold", sys:"vex", type:"dark", r:17, dist:300, ang:3.9, speed:0.006, col:[150,120,170], col2:[80,60,100],  bias:"money"},
 {id:"zer1", n:"Nerith",   sys:"zer", type:"ice",  r:15, dist:170, ang:0.4, speed:0.011, col:[200,225,250], col2:[130,165,205],bias:"research"},
 {id:"zer2", n:"Volturn",  sys:"zer", type:"gas",  r:22, dist:340, ang:2.8, speed:0.005, col:[190,205,240], col2:[120,140,190],bias:"energy", ring:1},
 {id:"zer3", n:"Calder",   sys:"zer", type:"rock", r:13, dist:480, ang:5.0, speed:0.004, col:[205,140,100], col2:[135,85,55],  bias:null},
 {id:"kae1", n:"Peridia",  sys:"kae", type:"rock", r:16, dist:180, ang:2.0, speed:0.010, col:[210,170,110], col2:[140,105,60], bias:"mat"},
 {id:"kae2", n:"Thalassa", sys:"kae", type:"ice",  r:14, dist:330, ang:4.6, speed:0.006, col:[170,215,235], col2:[105,150,185],bias:"research"},
];
// runtime arrays = authored base + this game's generated galaxy (space.js)
let SPACE_SYSTEMS = SPACE_SYSTEMS_BASE.slice();
let SPACE_PLANETS = SPACE_PLANETS_BASE.slice();
const SPACE_COSTS = {
  launch:   { money: 150, energy: 25 },        // per spacecraft sent to orbit
  colonize: { money: 2500, mat: 1000 },        // found a colony (needs Colony Ships tech)
  colonyUp: lvl => ({ money: Math.round(1500 * Math.pow(1.8, lvl - 1)), mat: Math.round(600 * Math.pow(1.8, lvl - 1)) }),
};
const COLONY_MAX_LVL = 5;
// megastructures — Dyson costs per stage; Halo cost is total. ticks = economic game ticks of work
const MEGA_DEFS = {
  // BUG REPORT fix: a Dyson Sphere is THE late-game energy answer — each stage
  // pours out a million units of energy, ending shortages for its owner forever.
  dyson: { n:"Dyson Sphere", icon:"☀", tech:"dysonsphere", stages:3, cost:{money:25000,mat:10000}, ticks:30, energyPerStage:1000000,
    d:"A lattice of collectors swallowing the star. Each completed stage adds +1,000,000 energy — a near-infinite power source." },
  halo:  { n:"Halo Ring", icon:"⭕", tech:"haloring", cost:{money:20000,mat:9000}, ticks:25,
    d:"An orbital ring-world: +8 population capacity, +80 money, +50 research and a fortified colony below." },
  // ---- Space Update megastructures ----
  rehab: { n:"Rehabilitator", icon:"♻", tech:"rehab_t", cost:{money:30000,mat:14000}, ticks:25, rebuildMult:3,
    d:"A planetary restoration engine. Repairs a world scorched by a Star Destroyer; at triple cost it can even reassemble a destroyed planet." },
  shield:{ n:"Giant Shield", icon:"🛡", tech:"shield_t", cost:{money:22000,mat:11000,energy:400}, hp:9000, repairFrac:0.3,
    d:"A vast energy barrier around a planet, Dyson Sphere or Researcher. Absorbs Star Destroyer fire until its charge collapses. Can be repaired." },
  researcher:{ n:"Researcher", icon:"🌆", tech:"researcher_t", cost:{money:26000,mat:12000}, hp:3000, maxLvl:5,
    d:"An enormous city adrift in space. Produces vast research, improves exploration and can search the void for alien life." },
};
// Researcher scaling & the Locate Interstellar Life ability (Part 9)
const RESEARCHER_UP = lvl => ({ money: Math.round(14000 * Math.pow(1.6, lvl - 1)), mat: Math.round(7000 * Math.pow(1.6, lvl - 1)) });
const RESEARCHER_RP = lvl => 90 * lvl;
const RESEARCHER_REVIVE_FRAC = 0.6; // of build cost, keeps upgrades
const LOCATE_LIFE = { money: 6000, energy: 800, cd: 10, chance: 0.25 };
// Star Destroyer planet-killing laser (Part 1): huge cost, very long cooldown
const SD_LASER = { money: 9000, mat: 4500, energy: 1200, cd: 12, dmg: 6000 };
const DYSON_HP = 6000; // Dyson Spheres can be shot down (Part 1)
// Space Update 2 Part 9: ship-to-ship combat rebalance. Weapon output is up and
// armour mitigation down so equal fleets finish in tens of seconds, not tens of
// minutes — big hulls stay durable through raw HP, not immortal math.
const SPACE_DMG_MULT = 1.4;   // was 0.55 — flat damage multiplier on ship attack
const SPACE_DEF_MIT = 0.9;    // was 1.6 — defence weight in the mitigation curve
// Space Update 2 Part 13: repeatable military upgrades (Military ▸ Upgrades).
// Research-style: pay resources to start a level, then research points finish
// it (a tech in progress takes the research first). Effects stack per level.
const MIL_UPGRADES = {
  spd: { n:"Speed Upgrade",  icon:"🥾", perLvl:0.005, d:"All units and spacecraft move +0.5% faster per level." },
  dmg: { n:"Damage Upgrade", icon:"⚔",  perLvl:0.01,  d:"All units and spacecraft deal +1% damage per level."  },
  arm: { n:"Armor Upgrade",  icon:"🛡",  perLvl:0.01,  d:"All units and spacecraft gain +1% defence per level." },
};
const MIL_UP_MAX_LVL = 500;
const MIL_UP_COST = lvl => ({           // cost of researching level (lvl+1)
  money: Math.round(2000 * (1 + lvl * 0.15)),
  mat:   Math.round(800  * (1 + lvl * 0.15)),
  rp:    Math.round(1500 * (1 + lvl * 0.12)),
});
// Capital planet system (Part 12)
const CAPITAL_PLANET = { cost:{money:8000,mat:3000}, cd: 20, shockTicks: 10, bonus: 2.0, shockMorale: 12, shockStab: 15 };
// Alien civilizations (Parts 7-8, 11)
const ALIEN_BASE_ID = 800, REBEL_BASE_ID = 900;
const ALIEN_DETECT_CHANCE = 0.001; // per tick once any Dyson Sphere stage stands
const ALIEN_TIERS = [null,
 {n:"Primitive",           ships:0, colonies:1, power:0.3, era:2},
 {n:"Moderately Advanced", ships:3, colonies:1, power:1.0, era:6},
 {n:"Highly Advanced",     ships:6, colonies:2, power:2.2, era:8},
 {n:"Hyper-Advanced",      ships:9, colonies:3, power:4.0, era:9, dyson:1, shield:1, sd:1},
];
// Final Alien Update — every alien civilization has ONE capital planet; taking
// it defeats the civilization, and CONQUERING (not destroying) it pays spoils
// far beyond any normal capture: tech stockpiles, rare matter, energy reserves.
// Values are per alien tier (×1 primitive … ×4 hyper-advanced).
const ALIEN_CAPITAL = { money: 15000, mat: 9000, energy: 3000, research: 400 };
// Final Alien Update Part 8 — real-time colony invasion battles (space.js):
// logical battlefield size and pacing knobs for the ground-war simulation
const PBATTLE = {
  W: 320, H: 180,        // logical battlefield units
  dmg: 1.15,             // global damage scale (higher = shorter battles)
  supportCd: 5,          // seconds between orbital support strikes
  supportDmg: 30,        // damage per orbital strike (blocked by Giant Shields)
  reinforceCd: 2.2,      // seconds between drop-pod reinforcements from orbit
  retreatAt: 0.25,       // AI attackers fall back below this fraction of strength
};
// Revolutions (QoL update §7): both morale AND stability below the threshold
const REV_THRESHOLD = 40, REV_BASE_CHANCE = 0.02, REV_COOLDOWN = 20;
// passive city-morale from advanced infrastructure (QoL §7)
const BLDG_MORALE = { hospital: 1.0, university: 0.6, school: 0.2, lab: 0.6, commerce: 0.4 };
// unit merging (Part 2 §6)
const MERGE_MAX_STACK = 3;    // at most 3 units combined into one stack
const MERGE_COST_FRAC = 0.20; // money per absorbed unit, as a fraction of its recruit cost

// ============ AI IMPROVEMENTS update ============
// Part 1 — war morale: a separate wartime spirit (0-100, 50 neutral) that
// buffers normal morale so wars no longer collapse straight into revolution.
const WAR_MORALE = {
  defendBoost: 15,  // rally when war is declared ON you (defensive war)
  attackBoost: 8,   // smaller rally when you start the war
  battleWin: 0.6,   // war morale gained when one of your armies destroys an enemy army
  battleLoss: 1.3,  // war morale lost when one of your armies is destroyed
  cityWin: 5, cityLoss: 8, capitalLoss: 14,
  exhaustStart: 25, // war weariness above this starts eroding war morale
};
// per-building upkeep overrides (default 0.5 money per building per tick)
const BLDG_MAINT = { industrial: 2, megafactory: 5 };
// per-building energy demand — the ONE table production() charges and the AI
// prices (AI building bug fix: the AI must see the same energy cliff the
// economy enforces, or it prices Laboratories and Mega Factories blind)
const BLDG_ENERGY = { factory: 5, lab: 8, refinery: 3, industrial: 6, megafactory: 20 };
// ============ Humanity Balance Update ============
// Two selectable balance modes for the Humans. The NATIONS entry keeps the
// Super-Buffed values (11 Intelligence, +30% research); Normal mode caps the
// species at the classic 10/10 and +20% at runtime. The active mode lives in
// G.humanityMode ("super" | "normal"), is chosen at game start (multiplayer
// votes on it), rides through saves and snapshots, and follows the NATION —
// the same for AI, host and client controllers.
const HUMAN_NATION_ID = 2;
const HUMANITY_MODES = {
  normal: { n: "Normal Humanity",       int: 10, research: 0.20, d: "+20% research points" },
  super:  { n: "Super-Buffed Humanity", int: 11, research: 0.30, d: "+30% research points" },
};
// Part 14.3 — buildings a COLONY can raise (space.js). Slots = 1 + colony level.
const COLONY_BLDGS = {
  mine:      {n:"Mine",             icon:"⛏", cost:{money:900, mat:350},  tech:"colonyships",  mat:15,            d:"+15 materials each tick from planetary deposits."},
  refinery:  {n:"Refinery",         icon:"⚗️", cost:{money:1600,mat:650},  tech:"colonyships",  mat:24,            d:"+24 materials each tick — half rate without a Mine on this colony."},
  industrial:{n:"Industrial Plant", icon:"🏗", cost:{money:2800,mat:1100}, tech:"autofactories",mat:40, money:12,  d:"+40 materials and +12 money each tick."},
  orbfab:    {n:"Orbital Fabricator",icon:"🛰", cost:{money:9000,mat:4000}, tech:"megaeng",      mat:110,           d:"Space-based production: +110 materials each tick, free of planetary limits."},
};
const COLONY_BLDG_SLOTS = lvl => 1 + lvl;
// Part 11 — a destroyed planet's shockwave kills every ship this close (+planet r)
const PLANET_BLAST_R = 170;
// Part 12 — Star Destroyer Hyper Lazer: space-only orbital strike against troops
const HYPER_LAZER = { money: 3000, energy: 600, cd: 8, dmg: 4200, radius: 110, delay: 1.4 };

// ============ Small Update — stellar harvesting & the solar-system weapon ============
// A Star Destroyer parked beside a sun can Harvest Stellar Energy. Every sun
// endures exactly `max` harvests, growing visibly dimmer each time; the third
// strips its last energy and the star collapses forever.
const STELLAR_HARVEST = {
  max: 3,     // harvests per sun, ever — a spent sun never recovers
  time: 24,   // real-time seconds of visible energy transfer per harvest
  rng: 260,   // how close the Star Destroyer must hold to the sun
  dim: 0.30,  // how much visibly dimmer each harvest leaves the star
};
// BUG REPORT (Critical Bug-Fix Update §5): a Dead Sun does not kill a system's
// economy outright — every planetary output there falls to 20% of normal.
// The ONE multiplier below is read by every real resource-calculation path:
// colony production, halo income, population capacity, alien economies and
// the Homeworld's entire map economy when the HOME sun dies. Sandbox included.
const DEAD_SUN = { prodMult: 0.20 };
// The Omni-Hypercharged Orbital Laser Strike: one stellar charge erases an
// entire solar system. Intentionally overpowered — and intentionally hard to
// use: Megastructure Era only, one full charge per shot, a fortune in
// resources, a very long cooldown, and it cannot fire while harvesting.
const OMNI_LASER = {
  money: 45000, mat: 22000, energy: 9000, // firing cost on top of the charge
  cd: 30,             // ticks between shots — a very long cooldown
  blast: 2.4,         // shockwave radius = system radius × this (far beyond the system)
  blastDmgFrac: 0.55, // ships in the outer shockwave lose this fraction of max hull
  meteorTicks: 26,    // how long the galaxy-wide debris event rains afterwards
};

// ============ Update — the galactic core & Phantom Step ============
// One unique supermassive black hole per galaxy. It can never be destroyed,
// colonized, moved or rebuilt — only harnessed.
const BLACK_HOLE = { r: 60, guardChance: 0.10 }; // 10% of galaxies: aliens already dwell at the core
const BH_HARVESTER = {
  n: "Black Hole Energy Harvester", tech: "bhharvest_t",
  stages: 4, cost: { money: 60000, mat: 30000, energy: 5000 }, // PER STAGE — enormous
  ticksPerStage: 12,   // long construction with visible stages
  hp: 40000,           // massive health — no weapon one-shots it
  shield: 12000,       // built-in great shield, absorbs damage first
  defDmg: 260, defRng: 240, defCd: 1.2, // built-in defensive weapons
  chargeTime: 16,      // seconds of visible charging per Omni-Laser charge
  chargeCd: 15,        // the Harvester's shared charge-cycle cooldown (ticks)
  shipCd: 8,           // a Star Destroyer's own harvest-systems cooldown (ticks)
  nearR: 240,          // how close a Star Destroyer must hold to connect
};
// Phantom Step: cloak an entire solar system from the galaxy. Strict cycle —
// 50 turns active, then it shuts down COMPLETELY and needs a 25-turn cooldown.
// No exceptions: players, AI countries and aliens all obey the same clock.
// BUG REPORT: activation needs BOTH the 🌫 Phantom Step research (tech below)
// AND a Deep Space Research Station; era-9 aliens carry the tech innately.
const PHANTOM = {
  tech: "phantom_t",
  active: 50, cooldown: 25,
  scanChance: 0.25,           // Deep Space Research Station disruption odds per hidden system
  cost: { money: 12000, energy: 2500 },
  deepLvl: 3, deepCost: { money: 18000, mat: 8000 }, // Researcher → Deep Space Research Station
  scanCost: { money: 4000, energy: 800 }, scanCd: 6,
};

// ============ AI Update §13 — VOID SHIELDS ============
// A system-wide barrier raised by a planetary (map) nation around a star it
// controls. While the generator stands, ALIEN fleets cannot enter the system,
// alien colonization there is impossible and alien invasions cannot land.
// Homeland nations are never blocked (§13.2) — the barrier reads their
// transponders. Aliens must destroy the generator (a legitimate war target,
// vulnerable to fleets and Star Destroyer fire alike) to break in.
const VOID_SHIELD = {
  n: "Void Shield", icon: "🌐", tech: "voidshield",
  cost: { money: 24000, mat: 11000, energy: 600 },
  ticks: 18,        // construction time (economic ticks) — the barrier rises visibly
  hp: 16000,        // generator strength — several major attacks to bring down
  repairFrac: 0.3,  // repair cost as a fraction of the build cost
};

// ============ Sandbox Improvement §2 — simulation speeds ============
// Sandbox Mode runs in real time like Realistic Mode; these are the selectable
// tick lengths (seconds per economic tick). Standard/Realistic are untouched.
const SANDBOX_SPEEDS = [
  { k: "normal", n: "Normal",    s: 3    },
  { k: "fast",   n: "Fast",      s: 1    },
  { k: "vfast",  n: "Very Fast", s: 0.5  },
  { k: "max",    n: "Maximum",   s: 0.25 },
];
