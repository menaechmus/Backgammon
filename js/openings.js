// The best opening moves, for the How to play box to teach: every roll, grouped
// by the idea behind its play. The plays are those of published computer
// rollouts, for a game at even stakes; the words are this game's own. No DOM
// here, and tests.html checks that each play is legal and that the Hard
// computer's first move is always one of those listed.
//
// A roll is { dice, best, also, why }, plays written as in the game: "13/7 8/7",
// and "13/3(2)" for two checkers making the same move.

export const OPENING_GROUPS = [
  {
    title: 'Make a point',
    idea: 'A made point blocks the other side and gives your checkers a safe place to land. These four rolls make one at once, and nothing beats that.',
    rolls: [
      { dice: [3, 1], best: '8/5 6/5', also: [], why: 'Makes your 5 point, the most valuable point on the board. This is the best opening roll of all.' },
      { dice: [4, 2], best: '8/4 6/4', also: [], why: 'Makes your 4 point, another strong block in front of their back checkers.' },
      { dice: [6, 1], best: '13/7 8/7', also: [], why: 'Makes your bar point. With your 6 and 8 points it forms a wall of three that stops their 6s.' },
      { dice: [5, 3], best: '8/3 6/3', also: [], why: 'Makes your 3 point. It is deep, but a made point is worth more than loose checkers.' },
    ],
  },
  {
    title: 'Get a back checker moving',
    idea: 'A 6 played on your own side leaves a lone checker on your bar point. So these rolls use it to start one of your two rearmost checkers on its way.',
    rolls: [
      { dice: [6, 5], best: '24/13', also: [], why: "Lover's leap: one back checker runs all the way to your 13 point and safety." },
      { dice: [6, 4], best: '24/18 13/9', also: ['8/2 6/2', '24/14'], why: 'Nobody knows which of the three is best. This one steps up to their bar point and brings down a builder.' },
      { dice: [6, 3], best: '24/18 13/10', also: ['24/15'], why: 'Steps up to their bar point, ready to make it or run, and brings down a builder.' },
      { dice: [6, 2], best: '24/18 13/11', also: [], why: 'Steps up to their bar point and brings down a builder for your next point.' },
    ],
  },
  {
    title: 'Build and split',
    idea: 'With no point to make, bring builders down from the 13 point to aim at your next one, and split your back checkers so that they are harder to shut in.',
    rolls: [
      { dice: [5, 4], best: '24/20 13/8', also: ['13/9 13/8'], why: 'Moves up to their 5 point, the best place for an anchor, and brings a checker safely to your 8 point.' },
      { dice: [5, 2], best: '24/22 13/8', also: ['13/11 13/8'], why: 'The 5 is safe, and the 2 splits the back checkers. Bringing down two instead is just as good.' },
      { dice: [5, 1], best: '24/23 13/8', also: ['13/8 6/5'], why: 'The 5 is safe, and the 1 splits the back checkers, giving your next roll more ways to make an anchor.' },
      { dice: [4, 3], best: '13/10 13/9', also: ['24/21 13/9', '24/20 13/10'], why: 'Two builders aimed at your 5 and 4 points. The other two plays split instead, and all three are close.' },
      { dice: [4, 1], best: '24/23 13/9', also: ['13/9 6/5'], why: 'A builder for your next point, and the 1 splits the back checkers.' },
      { dice: [3, 2], best: '24/21 13/11', also: ['13/11 13/10'], why: 'A builder, and a back checker moved up. Two builders instead is about as good.' },
      { dice: [2, 1], best: '13/11 6/5', also: ['24/23 13/11'], why: 'The bold play: the 1 slots your 5 point, hoping to cover it next turn. Splitting instead is about as good.' },
    ],
  },
  {
    title: 'Doubles',
    idea: 'Doubles cannot be your very first move, as the opening roll is one die each and ties roll again. These are the usual plays on your second turn, and what the other side has just done can change them.',
    rolls: [
      { dice: [6, 6], best: '24/18(2) 13/7(2)', also: [], why: 'Makes both bar points, yours and theirs.' },
      { dice: [5, 5], best: '13/3(2)', also: [], why: 'Makes your 3 point. Your back checkers cannot use 5s, as their 6 point blocks them.' },
      { dice: [4, 4], best: '24/20(2) 13/9(2)', also: [], why: 'Takes their 5 point as an anchor, and makes your 9 point.' },
      { dice: [3, 3], best: '8/5(2) 6/3(2)', also: [], why: 'Makes your 5 point and your 3 point in one roll.' },
      { dice: [2, 2], best: '13/11(2) 6/4(2)', also: [], why: 'Makes your 4 point and brings two builders down.' },
      { dice: [1, 1], best: '8/7(2) 6/5(2)', also: [], why: 'Makes your bar point and your 5 point in one roll.' },
    ],
  },
];

// A play as moves [from, to], a checker that moves on counted as one move from
// where it started to where it stops, as an arrow shows it.
export function parsePlay(play) {
  return play.split(' ').flatMap(part => {
    const [, from, to, times = 1] = /^(\d+)\/(\d+)(?:\((\d)\))?$/.exec(part);
    return new Array(Number(times)).fill([Number(from), Number(to)]);
  });
}
