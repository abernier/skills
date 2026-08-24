---
name: visual-debugging
description: Debug a visual, geometric or interactive bug in the running app — measure the DOM, never the screenshot. Use when a bug is about position, size, overlap, alignment, hit-testing or a pointer gesture, or when an aesthetic threshold has to be chosen.
---

# Visual and geometric debugging

Geometry fails in ways prose and screenshots can't settle. Answer _by how much, where, against what?_ with numbers, in the running app.

You have a real browser. Drive it.

## The URL is the repro

A URL carrying the app's state is a complete, deterministic reproduction. Paste it, or ask the developer for it, before reasoning about anything.

## The DOM is the evidence

**Read the DOM attributes to full float precision.** A screenshot rounds to a pixel and hides the sign of the error; the attribute is the number the code actually wrote.

**Validate the instrument first.** Drive the app with real pointer input, not synthesized events, and read state the way the app writes it. An instrument that lies produces a confident wrong answer.

**Park the pointer before comparative captures.** A resting cursor leaves a hover highlight that contaminates an A/B comparison. Load both sides fresh before calling anything a regression.

## A test is the verdict

Pin every invariant the browser reveals. Where one region is both _built_ and _decided_ — drawn by one path, hit-tested by another — a test must cross-check the two.

## Aesthetic choices go behind a temporary toggle

A threshold, an opacity, a radius, a colour: don't interrogate the developer blind and don't guess. Ship the candidates behind a temporary URL param, judge them in the browser, then delete the param. Only structural questions are worth a round-trip.
