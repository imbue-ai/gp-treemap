----------------------------------------------------------------------
  GrandPerspective, Version 3.6.4
----------------------------------------------------------------------

* INTRODUCTION

GrandPerspective is a small utility for macOS that can draw two-
dimensional views of disk use within a file system. This can help you
to manage your disk, as you can easily spot which files and folders
take up the most space.

The graphical representation is a logical one, where each file is
shown as a rectangle with an area proportional to the file's size.
Files in the same folder appear together, but other than that the
placement of files is arbitrary. You can observe this by resizing the
view window. The location of files will change, in order to keep the
rectangles as square as possible.


* SYSTEM REQUIREMENTS

  - macOS 11.0 or higher
  - Apple silicon or Intel-based processor


* CONTENTS

This version of GrandPerspective is released as two separate files:

  * GrandPerspective-3_6_4.dmg

      This is the main release file. It contains all you need to run
      the application. To install the application, open the disk
      image and drag the application icon onto your Applications
      folder, or wherever you want to put it on your file system.
      Next, run the application by clicking on the icon.

      The application contains translations in languages other than
      English. Some translations are updated after the initial
      release. Translation updates are released as:

        GrandPerspective-3_6_4-Lx.dmg

      Here x is a number that increases with each update. For the list
      of included languages, see LOCALIZATION.txt

  * GrandPerspective-3_6_4-src.tgz

      This contains the source code of the application. It consists of
      the Objective C source code, as well as various auxiliary files,
      such as the xib files that are used to construct the GUI.


* LICENSE

The GrandPerspective application has been released as Open Source
under the GNU General Public License. See COPYING.txt for details.


* THE WEBSITE

For more information about the application, please visit the website
at http://grandperspectiv.sourceforge.net. From there, you can
download the latest release of the software. It is also possible to
report bugs, make a donation, suggest additional features, provide
more general feedback, etc.


* CREDITS

Special thanks to all that have provided localizations of the
application: Albert Leng, Alp Tunc, Aristóteles Soares Benicio,
Carsten Bracke, Chris Li, Dimitris Pergelidis, Emir Sarı, Jorge Ruiz
Calpe, Helge Baumann, Javier Alfonso, Klaus Rade, Marc Croteau,
Matteo Guarnerio, Mattia Mazzucchelli, Mauricio Panata, Maxime
Hadjinlian, Michael Wagner, Mikko Oksalahti, Rex Chiu and Whyto.

Many thanks to everyone that has shown support by making donations.
They have been used to fund the required upgrade to Leopard, which has
enabled me to build Universal Binaries.

Thanks to Matthew Carroll investigating the limitations of the initial
Full Disk Access permission check and for providing a resolution.

Thanks to Cœur for providing various code fixes to address compiler
and analyzer warnings.

Thanks to Aaron Madlon-Kay for noticing, investigating and fixing the
scan data format compatibility problem caused by a small datetime
formatting change introduced in macOS 10.11, for minor improvements to
the progress panel, and for updating the source code for XCode 7.2.

Also thanks to Martin Kahr who made Universal Binaries available for
early releases of GrandPerspective, and to Craig Hughes who helped me
early on to make the source code Intel-compatible.

Thanks to Miles Ponson (iTweek) for providing the free set of "knobs"
icons, which I used for the toolbar for many years (from Version 1.0
until 3.3).

Thanks to Keith Blount for developing and making available the source
code of various handy utility classes. His KBPopUpToolbarItem class
used to provide the pop-up menu functionality of the Rescan button in
the toolbar.

Thanks to the many users that have reported bugs and suggested
improvements. This has definitely made the application better than it
would otherwise have been. Lucky0 and aONe deserve special mentions
for the amount of useful feedback given.

Finally thanks to all that have helped to get the word out about the
application. Developing the application may be fun, but having actual
users makes it worthwhile.


* CONTACT DETAILS

The GrandPerspective application has been developed by Erwin Bonsma.
Please visit the website at http://grandperspectiv.sourceforge.net for
details on how to contact me.
