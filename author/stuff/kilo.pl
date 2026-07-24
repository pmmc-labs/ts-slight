#!perl

use v5.42;
use experimental qw[ class switch ];

use Term::ReadKey qw[
    GetTerminalSize
    GetControlChars
    ReadMode
    ReadKey
];

## -----------------------------------------------------------------------------

our $IN  = *STDIN;
our $OUT = *STDOUT;

our %CTRL_CHARS = GetControlChars($IN);
our ($SCREENCOLS, $SCREENROWS) = GetTerminalSize();

our $BUFFER = '';

our $CX = 0;
our $CY = 0;

our $FILENAME;

our $ROWOFFSET = 0;
our $COLOFFSET = 0;

our $NUMROWS = 0;
our @ROWS;

our $STATUSMESSAGE = '';
our $STATUSTIME    = 0;

## -----------------------------------------------------------------------------

sub is_ctrl_char ($c) { exists $CTRL_CHARS{$c} }

sub CTRL_KEY ($k) { chr(ord($k) & 0x1f) }

## -----------------------------------------------------------------------------

sub disableRawMode {
    ReadMode 0, $IN;
}

sub enableRawMode {
    local $SIG{INT} = sub { disableRawMode(); die "Interuptted!"; };
    ReadMode 5, $IN;
    END { disableRawMode() }
}

## -----------------------------------------------------------------------------

sub appendBuffer ($c) {
    $BUFFER .= $c;
}

sub flushBuffer {
    syswrite( $OUT, $BUFFER );
    $BUFFER = '';
}

## -----------------------------------------------------------------------------

use constant ARROW_LEFT  => 'ARROW_LEFT';
use constant ARROW_RIGHT => 'ARROW_RIGHT';
use constant ARROW_UP    => 'ARROW_UP';
use constant ARROW_DOWN  => 'ARROW_DOWN';
use constant HOME_KEY    => 'HOME_KEY';
use constant DELETE_KEY  => 'DELETE_KEY';
use constant END_KEY     => 'END_KEY';
use constant PAGE_UP     => 'PAGE_UP';
use constant PAGE_DOWN   => 'PAGE_DOWN';
use constant BACKSPACE   => 127;


sub initEditor {
    $SCREENROWS--; # make room for status bar
    $SCREENROWS--; # make room for status message
}

sub editorOpen ( $file ) {
    my $fh;
    open $fh, '<', $file or die "Cannot open file $file for reading, because ".$!;

    while (my $line = readline($fh)) {
        chomp($line);
        editorAppendRow($line);
    }

    close $fh or die "Cannot close file $file for reading, because ".$!;

    $FILENAME = $file;
}

sub editorSave {
    return unless defined $FILENAME;

    my $file = $FILENAME;
    my $fh;
    open $fh, '>', $file or die "Cannot open file $file for writing, because ".$!;
    print $fh editorRowsToString();
    close $fh or die "Cannot close file $file for writing, because ".$!;
}


## -------------------------------------------------

sub editorAppendRow ($row) {
    push @ROWS => $row;
    editorUpdateRow($row);
}

# NOTE : also stuff was supposed to go in editorScroll too
sub editorRowCxToRx ($row, $cx) {
    return $cx; # tab stop stuff ...
}

sub editorUpdateRow ($row) {
    # .. handle the tab rendering stuff ...
}

sub editorRowInsertChar ($row, $at, $c) {
    #warn "at: $at c: '$c' row: '$row'";
    if ($at < 0 || $at > length($row)) {
        $row .= $c
    }
    else {
        substr($row, $at, 1, $c);
        #warn "AFTER: '$row'";
    }
    $ROWS[$CY] = $row;
    editorUpdateRow($row);
}

sub editorInsertChar ($c) {
    if ($CY == scalar(@ROWS)) {
        editorAppendRow("");
    }
    editorRowInsertChar($ROWS[$CY], $CX, $c);
    $CX++;
}

## -------------------------------------------------

sub editorDrawStatusBar {
    appendBuffer("\e[7m");
    my $status   = sprintf ' %s - %d lines' => $FILENAME, scalar(@ROWS);
    my $lineinfo = sprintf '%d/%d' => $CY + 1, scalar(@ROWS);
    appendBuffer( $status );
    appendBuffer( ' ' x ($SCREENCOLS - (length($status) + length($lineinfo))) );
    appendBuffer( $lineinfo );
    appendBuffer("\e[0m");
    appendBuffer("\r\n");
}

sub editorDrawMessageBar {
    appendBuffer("\e[K");
    if (scalar(time()) - $STATUSTIME < 5) {
        appendBuffer( $STATUSMESSAGE );
        appendBuffer( ' ' x ($SCREENCOLS - length($STATUSMESSAGE)) );
    }
}

sub editorSetStatusMessage ($msg) {
    $STATUSMESSAGE = $msg;
    $STATUSTIME = time();
}

sub editorReadKey {
    my $c = ReadKey(0, $IN);
    if ($c eq "\e") {
        my $seq0 = ReadKey(0, $IN);
        if ($seq0 eq '[') {
            my $seq1 = ReadKey(0, $IN);
            if ($seq1 ge '0' && $seq1 le '9') {
                my $seq2 = ReadKey(0, $IN);
                if ($seq2 eq '~') {
                    given ($seq1) {
                        when ('1') { return HOME_KEY }
                        when ('3') { return DELETE_KEY }
                        when ('4') { return END_KEY }
                        when ('5') { return PAGE_UP }
                        when ('6') { return PAGE_DOWN }
                        when ('7') { return HOME_KEY }
                        when ('8') { return END_KEY }
                    }
                }
            } else {
                given ($seq1) {
                    when ('A') { return ARROW_UP    }
                    when ('B') { return ARROW_DOWN  }
                    when ('C') { return ARROW_RIGHT }
                    when ('D') { return ARROW_LEFT  }
                }
            }
        }
        return "\e";
    } else {
        return $c;
    }
}

sub editorMoveCursor ($c) {
    my $row = $CY >= scalar(@ROWS) ? undef : $ROWS[$CY];

    given ($c) {
        when (ARROW_LEFT) {
            if ($CX != 0) {
                $CX--;
            }
            elsif ($CY > 0) {
                $CY--;
                $CX = length($ROWS[$CY]);
            }
        }
        when (ARROW_RIGHT) {
            if (defined $row && $CX < length($row)) {
                $CX++;
            }
            elsif (defined $row && $CX == length($row)) {
                $CY++;
                $CX = 0;
            }
        }
        when (ARROW_UP) {
            $CY-- if $CY != 0;
        }
        when (ARROW_DOWN) {
            $CY++ if $CY < scalar(@ROWS);
        }
    }

    $row = $CY >= scalar(@ROWS) ? undef : $ROWS[$CY];
    my $row_length = defined $row ? length($row) : 0;
    if ($CX > $row_length) {
        $CX = $row_length;
    }

}

sub editorProcessKeyPress {
    my $c = editorReadKey();

    if ($c eq "\r") {
        ; # do nothing ... for now
    }
    elsif ($c eq CTRL_KEY('q')) {
        appendBuffer( "\e[2J" );
        appendBuffer( "\e[H" );
        appendBuffer( "\e[?25h" );
        flushBuffer();
        exit(0);
    }
    elsif ($c eq CTRL_KEY('s')) {
        editorSave();
    }
    elsif ($c eq HOME_KEY) {
        $CX = 0;
    }
    elsif ($c eq END_KEY) {
        $CX = $SCREENCOLS - 1;
    }
    elsif (ord($c) eq BACKSPACE ||
            $c eq CTRL_KEY('h') ||
            $c eq DELETE_KEY    ){
        ; # do nothing ... for now
    }
    elsif ($c eq PAGE_UP || $c eq PAGE_DOWN) {
        editorMoveCursor( $c eq PAGE_UP ? ARROW_UP : ARROW_DOWN )
            foreach 0 .. $SCREENROWS;
    }
    elsif ($c eq ARROW_LEFT  ||
           $c eq ARROW_RIGHT ||
           $c eq ARROW_UP    ||
           $c eq ARROW_DOWN  ){
        editorMoveCursor($c)
    }
    elsif ($c eq CTRL_KEY('l') || $c eq "\e" ){
        ; # do nothing ...
    }
    else {
        editorInsertChar($c);
    }

    return true;
}

sub editorScroll {
    if ($CY < $ROWOFFSET) {
        $ROWOFFSET = $CY;
    }
    if ($CY >= ($ROWOFFSET + $SCREENROWS)) {
        $ROWOFFSET = $CY - $SCREENROWS + 1;
    }

    if ($CX < $COLOFFSET) {
        $COLOFFSET = $CX;
    }
    if ($CX >= $COLOFFSET + $SCREENCOLS) {
        $COLOFFSET = $CX - $SCREENCOLS + 1;
    }
}

sub editorRefreshScreen {
    editorScroll();

    appendBuffer( "\e[?25l" );
    appendBuffer( "\e[H" );

    editorDrawRows();
    editorDrawStatusBar();
    editorDrawMessageBar();

    appendBuffer( sprintf "\e[%d;%dH" => ($CY - $ROWOFFSET) + 1, ($CX - $COLOFFSET) + 1 );
    appendBuffer( "\e[?25h" );
    flushBuffer();
}

sub editorDrawRows {
    my $numRows = scalar @ROWS;
    for (my $y = 0; $y < $SCREENROWS; $y++ ) {
        my $fileRow = $y + $ROWOFFSET;
        if ($fileRow >= $numRows) {
            if ($numRows == 0 && $y == $SCREENROWS / 2) {
                my $welcome = sprintf 'Kilo editor -- version : %f' => 0.1;
                my $padding = ($SCREENCOLS - length($welcome)) / 2;
                appendBuffer( join '' => '~', (' ' x ($padding - 1)), $welcome );
            } else {
                appendBuffer( "~" );
            }
        } else {
            my $row  = $ROWS[$fileRow];
            my $line = substr($row, $COLOFFSET, length($row));
            appendBuffer( substr( $line, 0, $SCREENCOLS ) );
        }

        appendBuffer( "\e[K" );
        appendBuffer( "\r\n" );
    }
}

sub editorRowsToString {
    join "\n" => @ROWS;
}

## -----------------------------------------------------------------------------

sub main ( $file ) {
    enableRawMode();
    initEditor();
    if (-e $file ) {
        editorOpen( $file );
    }

    editorSetStatusMessage('HELP: Ctrl-S = save | Ctrl-Q = quit');

    while (true) {
        editorRefreshScreen();
        editorProcessKeyPress();
    }

    disableRawMode();
    return 0;
}


main(@ARGV);



