#!perl

use v5.42;
use utf8;
use open ':std', ':encoding(UTF-8)';
use experimental qw[ class switch ];

class DividedSquare {
    field $level   :param :reader;
    field $corners :param :reader;

    field $horz_bar;
    field @spacer;

    ADJUST {
        my $hmul   = ((2 ** $level) - 1);
        my $vmul   = ((2 ** ($level - 1)) - 1);
        my $spc    = ' ' x $hmul;
        my $space  = join '' => '│', $spc, '│', $spc, '│';
        $horz_bar  = '─' x $hmul;
        @spacer    = ($space) x $vmul;
    }

    our $ROSE = '┼';

    our @NW = qw[ ┌ ├ ┼ ┬ ];
    our @N  = qw[ ┬ ┼ ];
    our @NE = qw[ ┐ ┤ ┼ ┬ ];
    our @E  = qw[ ┤ ┼ ];
    our @SE = qw[ ┘ ┤ ┼ ┴ ];
    our @S  = qw[ ┴ ┼ ];
    our @SW = qw[ └ ├ ┼ ┴ ];
    our @W  = qw[ ├ ┼ ];

    method render {
        my ($nw, $n, $ne, $e, $se, $s, $sw, $w) = @$corners;
        ((join '' => $NW[$nw], $horz_bar, $N[$n], $horz_bar, $NE[$ne]),
         @spacer,
         (join '' => $W[$w],   $horz_bar, $ROSE,  $horz_bar, $E[$e]),
         @spacer,
         (join '' => $SW[$sw], $horz_bar, $S[$s], $horz_bar, $SE[$se]))
    }
}

class QuadTree {
    field $levels  :param :reader;
    field @corners :reader;

    our @CORNERS = (
        [ 0, 0, 3, 1, 2, 1, 1, 0 ],
        [ 3, 0, 0, 0, 1, 1, 2, 1 ],
        [ 1, 1, 2, 1, 3, 0, 0, 0 ],
        [ 2, 1, 1, 0, 0, 0, 3, 1 ],
    );



    ADJUST {
        foreach my ($i, $level) (indexed @$levels) {
            push @corners => DividedSquare->new( level => $level, corners => $CORNERS[$i] );
        }
    }

    method render {
        my @tl = $corners[0]->render;
        my @tr = $corners[1]->render;
        my @bl = $corners[2]->render;
        my @br = $corners[3]->render;

        shift @bl;
        shift @br;

        my @lhs = (@tl, @bl);
        my @rhs = (@tr, @br);

        my @out;
        foreach my ($i, $lhs) (indexed @lhs) {
            push @out => $lhs . substr($rhs[$i], 1);
        }
        return @out;
    }

}

say $_ foreach DividedSquare->new( level => 1, corners => [ (0) x 8 ] )->render;

say $_ foreach QuadTree->new( levels => [ 1, 1, 1, 1 ] )->render;

__END__


0, 1, 3, 7, 15, 31

┌───────┬───┬─┬─┬───────┬───┬─┬─┐
│       │   ├─┼─┤       │   ├─┼─┤
│       ├───┴─┴─┤       ├───┴─┴─┤
│       │       │       │       │
├───────┼───────┼───┬───┼───────┤
│       │       │   │   │       │
│       │       ├───┼───┤       │
│       │       │   │   │       │
├───────┼─┬─┬─┬─┼─┬─┼───┼───────┤
│       ├─┼─┼─┼─┼─┼─┤   │       │
│       ├─┴─┴─┴─┼─┴─┴───┤       │
│       │       │       │       │
├───────┼───┬─┬─┼───────┼───┬─┬─┤
│       │   ├─┼─┤       │   ├─┼─┤
│       ├───┴─┴─┤       ├───┴─┴─┤
│       │       │       │       │
└───────┴───────┴───────┴───────┘


┌─┬─┐
├─┼─┤
└─┴─┘

┌───┬───┐
│   │   │
├───┼───┤
│   │   │
└───┴───┘

┌───────┬───────┐
│       │       │
│       │       │
│       │       │
├───────┼───────┤
│       │       │
│       │       │
│       │       │
└───────┴───────┘
