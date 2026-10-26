# Rumor Engine

Rumor Engine is a small, browser-based network simulation for exploring how an illustrative rumor might spread through a connected group of people. It is built with vanilla HTML, CSS, and JavaScript, and uses Canvas for the network visualization.

This is an educational model, not an empirically validated predictor of real-world behavior.

## Run it locally

No installation or build step is needed. Open `index.html` in a modern browser, or serve this directory with any static server. For example, if Python is available:

```powershell
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Controls

- **The Spark**, **The Skeptics**, and **The Influencers** load reproducible experiment settings.
- Set the **network size**, **base sharing**, **base skepticism**, and numeric **random seed**. Changing a parameter regenerates the network.
- Click an uninformed node to choose it as the rumor source, or choose a random source.
- **Start** advances a step every 700ms. **Pause** stops it. **Step** advances exactly one discrete step. **Reset** regenerates the current setup from its seed.
- Hover a node to see its ID and number of connections. White-outlined nodes in The Influencers preset are high-reach connectors.

## Simulation rules

1. A seeded person begins informed.
2. On each discrete step, every informed person can attempt to share with each uninformed neighbor.
3. The model makes two distinct probability decisions. A sender attempts to share with chance `base sharing × sender sharing tendency × sender reach`; a reached recipient accepts with chance `recipient trust × (1 - recipient skepticism)`. Their product is the expected chance for one communication path.
4. All attempts are collected before recipients update. If several people reach the same recipient, their acceptance chances are combined as `1 - product(1 - chance)`. This prevents same-step cascades from depending on processing order.
5. A recipient that accepts becomes informed for the next step and may retransmit then. A recipient who declines a received rumor becomes skeptical and does not receive further attempts in this simple model.

The pseudorandom generator and each preset seed are deterministic: resetting a configuration produces the same network and sequence of probabilistic decisions.

## Limitations

- Connections and attributes are generated synthetically; they do not represent real communities.
- People have only a few static attributes, and skepticism is treated as a permanent decision once exposed.
- The model does not capture content, fact checking, social context, changing beliefs, or real-world platform behavior.
