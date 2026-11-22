[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/Agus12341/sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/Agus12341/sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

# Sokoban Solver

A push-optimal Sokoban solver for make.fun's [Build the best Sokoban solver](https://make.fun/bounty/sokoban-solver-01-run-20261121) bounty. It cuts each level's hallway out of the floor (a box there is lost), solves every room on its own with an A\* search over pushes — dead-square and frozen-2x2 pruning, reverse-pull distance estimates — and walks the player between rooms, so the moves it writes use the fewest pushes possible. Node 22, standard library only, deterministic.

Run it the way the grader does:

```
node main.ts   # reads /input/<id>/level.txt, writes /output/<id>/solution.txt
```
