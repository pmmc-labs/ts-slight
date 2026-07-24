#!perl

use v5.42;
use experimental qw[ class switch ];

## -----------------------------------------------------------------------------

class Editor {
    use Term::ReadKey ();

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

    sub CTRL_KEY ($k) { chr(ord($k) & 0x1f) }

    field $input  :param :reader = *STDIN;
    field $output :param :reader = *STDOUT;

    #field %control_chars :reader;

    field $screen_cols :reader;
    field $screen_rows :reader;

    field @rows :reader;
    field $cx   :reader = 0;
    field $cy   :reader = 0;

    field $buffer   :reader = '';
    field $filename :reader;

    field $row_offset :reader = 0;
    field $col_offset :reader = 0;

    field $status_msg  :reader = '';
    field $status_time :reader = 0;

    ## -------------------------------------------------------------------------

    method initEditor {
        #%control_chars = Term::ReadKey::GetControlChars($input);
        ($screen_cols, $screen_rows) = Term::ReadKey::GetTerminalSize();
        $screen_rows -= 2; # make room for status and error bar
    }

    ## -------------------------------------------------------------------------

    method disableRawMode {
        Term::ReadKey::ReadMode( 0, $input );
    }

    method enableRawMode {
        $SIG{INT} = sub {
            Term::ReadKey::ReadMode( 0, $input // *STDIN );
            die "Interuptted!";
        };
        Term::ReadKey::ReadMode( 5, $input );
        END {
            Term::ReadKey::ReadMode( 0, $input // *STDIN )
        }
    }

    method editorReadKey {
        my $c = Term::ReadKey::ReadKey(0, $input);
        if ($c eq "\e") {
            my $seq0 = Term::ReadKey::ReadKey(0, $input);
            if ($seq0 eq '[') {
                my $seq1 = Term::ReadKey::ReadKey(0, $input);
                if ($seq1 ge '0' && $seq1 le '9') {
                    my $seq2 = Term::ReadKey::ReadKey(0, $input);
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

    ## -------------------------------------------------------------------------

    method editorSetStatusMessage ($msg) {
        $status_msg  = $msg;
        $status_time = time();
    }

    ## -------------------------------------------------------------------------

    method appendBuffer ($c) {
        $buffer .= $c;
    }

    method flushBuffer {
        syswrite( $output, $buffer );
        $buffer = '';
    }

    ## -------------------------------------------------------------------------

    method editorOpen ( $path ) {
        my $fh;
        open $fh, '<', $path or die "Cannot open file ${path} for reading, because ".$!;
        while (my $line = readline($fh)) {
            chomp($line);
            $self->editorInsertRow( scalar(@rows), $line );
        }
        close $fh or die "Cannot close file ${path} for reading, because ".$!;
        $filename = $path;
    }

    method editorSave {
        return unless defined $filename;
        my $fh;
        open $fh, '>', $filename or die "Cannot open file ${filename} for writing, because ".$!;
        print $fh join "\n" => @rows;
        close $fh or die "Cannot close file ${filename} for writing, because ".$!;
    }

    ## -------------------------------------------------------------------------

    method editorInsertRow ($at, $row) {
        return if $at < 0 || $at > scalar(@rows);
        splice @rows, $at, 0, $row;
    }

    method editorDelRow ($at) {
        splice @rows, $at, 1;
    }

    method editorRowAppendString ($row, $string, ) {
        $row . $string;
    }

    # NOTE : also stuff was supposed to go in editorScroll too
    method editorRowCxToRx ($row, $cx) {
        return $cx; # tab stop stuff ...
    }

    method editorRowDelChar ($row, $at) {
        return if $at < 0 || $at > length($row);
        substr($row, $at, 1, '');
        return $row;
    }

    method editorRowInsertChar ($row, $at, $c) {
        if ($at < 0 || $at > length($row)) {
            $row .= $c
        }
        else {
            substr($row, $at, 0, $c);
        }
        return $row;
    }

    method editorDelChar {
        return if $cy == scalar @rows;
        return if $cx == 0 && $cy == 0;

        if ($cx > 0) {
            $rows[$cy] = $self->editorRowDelChar( $rows[$cy], $cx - 1 );
            $cx--;
        } else {
            $cx = length( $rows[$cy - 1] );
            $rows[$cy - 1] = $self->editorRowAppendString($rows[$cy - 1], $rows[$cy]);
            $self->editorDelRow($cy);
            $cy--
        }
    }

    method editorInsertChar ($c) {
        $self->editorInsertRow( scalar(@rows), "" ) if $cy == scalar(@rows);
        $rows[$cy] = $self->editorRowInsertChar( $rows[$cy], $cx, $c );
        $cx++;
    }

    method editorInsertNewline {
        if ($cx == 0) {
            $self->editorInsertRow( $cy, "" );
        } else {
            my $rest = substr( $rows[$cy], $cx, length($rows[$cy]), '' );
            $self->editorInsertRow( $cy + 1, $rest );
        }
        $cy++;
        $cx = 0;
    }

    ## -------------------------------------------------------------------------

    method editorRefreshScreen {
        $self->editorScroll;

        $self->appendBuffer( "\e[?25l" );
        $self->appendBuffer( "\e[H" );

        $self->editorDrawRows;
        $self->editorDrawStatusBar;
        $self->editorDrawMessageBar;

        $self->appendBuffer( sprintf "\e[%d;%dH" => ($cy - $row_offset) + 1, ($cx - $col_offset) + 1 );
        $self->appendBuffer( "\e[?25h" );
        $self->flushBuffer;
    }

    method editorDrawRows {
        my $numRows = scalar @rows;
        for (my $y = 0; $y < $screen_rows; $y++ ) {
            my $fileRow = $y + $row_offset;
            if ($fileRow >= $numRows) {
                if ($numRows == 0 && $y == $screen_rows / 2) {
                    my $welcome = sprintf 'Kilo editor -- version : %f' => 0.1;
                    my $padding = ($screen_cols - length($welcome)) / 2;
                    $self->appendBuffer( join '' => '~', (' ' x ($padding - 1)), $welcome );
                } else {
                    $self->appendBuffer( "~" );
                }
            } else {
                my $row  = $rows[$fileRow];
                my $line = substr($row, $col_offset, length($row));
                $self->appendBuffer( substr( $line, 0, $screen_cols ) );
            }
            $self->appendBuffer( "\e[K" );
            $self->appendBuffer( "\r\n" );
        }
    }

    method editorDrawStatusBar {
        $self->appendBuffer("\e[7m");
        my $status   = sprintf ' %s - %d lines' => $filename, scalar(@rows);
        my $lineinfo = sprintf '%d/%d' => $cy + 1, scalar(@rows);
        $self->appendBuffer( $status );
        $self->appendBuffer( ' ' x ($screen_cols - (length($status) + length($lineinfo))) );
        $self->appendBuffer( $lineinfo );
        $self->appendBuffer("\e[0m");
        $self->appendBuffer("\r\n");
    }

    method editorDrawMessageBar {
        $self->appendBuffer("\e[K");
        if (scalar(time()) - $status_time < 5) {
            $self->appendBuffer( $status_msg );
            $self->appendBuffer( ' ' x ($screen_cols - length($status_msg)) );
        }
    }

    ## -------------------------------------------------------------------------

    method editorScroll {
        $row_offset = $cy if $cy < $row_offset;
        $col_offset = $cx if $cx < $col_offset;
        $row_offset = $cy - $screen_rows + 1 if $cy >= $row_offset + $screen_rows;
        $col_offset = $cx - $screen_cols + 1 if $cx >= $col_offset + $screen_cols;
    }

    method editorMoveCursor ($c) {
        my $row = $cy >= scalar(@rows) ? undef : $rows[$cy];
        given ($c) {
            when (ARROW_LEFT) {
                if ($cx != 0) {
                    $cx--;
                }
                elsif ($cy > 0) {
                    $cy--;
                    $cx = length($rows[$cy]);
                }
            }
            when (ARROW_RIGHT) {
                if (defined $row && $cx < length($row)) {
                    $cx++;
                }
                elsif (defined $row && $cx == length($row)) {
                    $cy++;
                    $cx = 0;
                }
            }
            when (ARROW_UP) {
                $cy-- if $cy != 0;
            }
            when (ARROW_DOWN) {
                $cy++ if $cy < scalar(@rows);
            }
        }
        $row = $cy >= scalar(@rows) ? undef : $rows[$cy];
        my $row_length = defined $row ? length($row) : 0;
        if ($cx > $row_length) {
            $cx = $row_length;
        }
    }

    ## -------------------------------------------------------------------------

    method editorProcessKeyPress {
        my $c = $self->editorReadKey();

        if ($c eq "\r") {
            $self->editorInsertNewline;
        }
        elsif ($c eq CTRL_KEY('q')) {
            $self->appendBuffer( "\e[2J" );
            $self->appendBuffer( "\e[H" );
            $self->appendBuffer( "\e[?25h" );
            $self->flushBuffer();
            exit(0);
        }
        elsif ($c eq CTRL_KEY('s')) {
            $self->editorSave();
        }
        elsif ($c eq HOME_KEY) {
            $cx = 0;
        }
        elsif ($c eq END_KEY) {
            $cx = $screen_cols - 1;
        }
        elsif (ord($c) eq BACKSPACE || $c eq CTRL_KEY('h') || $c eq DELETE_KEY ){
            $self->editorMoveCursor( ARROW_RIGHT ) if $c eq DELETE_KEY;
            $self->editorDelChar;
        }
        elsif ($c eq PAGE_UP || $c eq PAGE_DOWN) {
            $self->editorMoveCursor( $c eq PAGE_UP ? ARROW_UP : ARROW_DOWN )
                foreach 0 .. $screen_rows;
        }
        elsif ($c eq ARROW_LEFT  ||
               $c eq ARROW_RIGHT ||
               $c eq ARROW_UP    ||
               $c eq ARROW_DOWN  ){
            $self->editorMoveCursor($c)
        }
        elsif ($c eq CTRL_KEY('l') || $c eq "\e" ){
            ; # do nothing ...
        }
        else {
            $self->editorInsertChar($c);
        }

        return true;
    }

    ## -------------------------------------------------------------------------

    method edit ( $path ) {
        $self->enableRawMode;
        $self->initEditor;

        if (-e $path ) {
            $self->editorOpen( $path );
        }

        $self->editorSetStatusMessage('HELP: Ctrl-S = save | Ctrl-Q = quit');

        while (true) {
            $self->editorRefreshScreen;
            $self->editorProcessKeyPress;
        }

        $self->disableRawMode;
        return 0;
    }
}


Editor->new->edit(@ARGV);

