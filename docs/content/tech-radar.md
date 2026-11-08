# Tech Radar

The Tech Radar is a general view of the technology world: the [Thoughtworks Technology Radar](https://www.thoughtworks.com/radar), shown inside the portal so you can explore it without leaving. It is **an industry reference, not a list of what any one company uses**. Thoughtworks publishes a new volume about twice a year, and the portal always shows the latest one.

Open it from **Tech Radar** in the left sidebar, or go to `/tech-radar`.

---

## Reading the radar

Every technology is a **dot with its name beside it**. You do not need to click anything to read a name.

| What you see | What it means |
|--------------|---------------|
| **Dot colour** | The ring (below) |
| **Distance from the centre** | How ready it is: the closer to the centre, the more ready |
| **▲ after a name** | Moved in since the last volume (closer to adopting) |
| **▼ after a name** | Moved out since the last volume |
| **New** tag (list and details) | New in this volume. About three quarters of the technologies in a volume are new, so this is shown in the list and details, not as a marker |
| **"…" at the end of a name** | The name was shortened to fit. Hover the dot, or open it, to see the full name |

### Rings

| Ring | Meaning |
|------|---------|
| **Adopt** | We strongly recommend this technology. Use it when appropriate |
| **Trial** | Worth pursuing. Understand how to build this capability |
| **Assess** | Worth exploring to understand how it will affect your enterprise |
| **Caution** (earlier volumes: **Hold**) | Approach with significant care: known risks that need deliberate mitigation. A volume uses one of the two names, so only the ring in use is drawn |

### Quadrants

**Languages & Frameworks**, **Platforms**, **Techniques** and **Tools**. Click a quadrant title to magnify it. The dots stay where they are; the quadrant just gets bigger, which helps when a ring is crowded.

---

## Exploring

- **Hover** a dot for a card with its name, ring, quadrant and what changed.
- **Click** a dot or its name for the full description, the sources it links to, related technologies and a link to its page on thoughtworks.com. **Esc** closes it.
- **Search** (press `/` to jump to it) looks through names and descriptions. Several words must all match.
- **Filter** by quadrant, by ring, or by what changed (**New** or **Moved**). Technologies that do not match fade instead of disappearing, so you keep your bearings. Chips show how many technologies each filter holds.
- **Radar / List** switches between the radar and a grouped list (quadrant, then ring). On screens narrower than about 1,280 px the list opens first, because the names on the radar need room; the radar and the magnify option are still one tap away.

### Sharing a view

Everything you set is kept in the address: search words, quadrants, rings, the changes filter, the view and the open technology. Copy the address to share exactly what you are looking at, for example `/tech-radar?quadrant=techniques&ring=adopt&blip=passkeys`. The browser's Back button closes an open technology.

---

## Where the data comes from

The page reads the latest volume from the public [thoughtworks-tech-radar-volumes](https://github.com/setchy/thoughtworks-tech-radar-volumes) repository, in your browser. To avoid hitting GitHub's request limit (shared by everyone on one office network) it keeps a copy for 24 hours. If GitHub cannot be reached it shows the saved copy and says so. If there is no saved copy it explains what failed and offers **Try again**.

The descriptions are Thoughtworks' text. The portal shows only basic formatting and `https` source links from them.

---

## Radar vs. Engineering Hub

The Tech Radar shows what the wider industry is doing. The [Engineering Hub](https://<your-domain>/engineering-docs) shows how your organization builds: guides, golden paths and examples.
