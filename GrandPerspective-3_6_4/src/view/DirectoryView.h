/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Cocoa/Cocoa.h>


/* Event fired when the color palette has changed. 
 */
extern NSString  *ColorPaletteChangedEvent;

/* Event fired when the color mapper has changed. This is the case when the color mapping scheme
 * changed, or when the scheme changed the way it maps file items to hash values.
 */
extern NSString  *ColorMappingChangedEvent;

/* Event fired when the display focus changed.
 */
extern NSString  *DisplayFocusChangedEvent;

@class AsynchronousTaskManager;
@class TreeLayoutBuilder;
@class FileItem;
@class FileItemTest;
@class FileItemMapping;
@class TreeDrawerSettings;
@class ItemPathDrawer;
@class ItemPathModelView;
@class OverlayDrawer;
@class ItemLocator;
@protocol FileItemMappingScheme;

@interface DirectoryView : NSView<NSMenuItemValidation> {
  AsynchronousTaskManager  *drawTaskManager;
  AsynchronousTaskManager  *overlayDrawTaskManager;

  // Even though layout builder could also be considered part of the itemTreeDrawerSettings, it is
  // maintained here, as it is also needed by the pathDrawer, and other objects.
  TreeLayoutBuilder  *layoutBuilder;

  ItemPathDrawer  *pathDrawer;
  ItemPathModelView  *pathModelView;
  ItemLocator  *selectedItemLocator;

  BOOL  showEntireVolume;

  NSImage  *treeImage;

  // The images used for zoom animations. While the zoom animation is happening, the new image is
  // generated (and treeImage is updated when done). Therefore separate images are used.
  NSImage  *zoomImage;
  NSImage  *zoomBackgroundImage;

  // The active position of the zoom area on screen
  NSRect  zoomBounds;
  NSRect  zoomBoundsStart;
  NSRect  zoomBoundsEnd;

  NSRect  pathEndRect;

  // Indicates the direction of the zoom animation.
  BOOL  zoomingIn;
  // Counter used to abort animations
  NSInteger  zoomAnimationCount;

  NSImage  *overlayImage;
  NSTimer  *redrawTimer;
  
  // Indicates if the image has been resized to fit inside the current view. This is only a
  // temporary measure. A new image is already being constructed for the new size, but as long as
  // that's not yet ready, the scaled image can be used.
  BOOL  treeImageIsScaled;
  BOOL  overlayImageIsScaled;

  // Indicates if a draw is in progress (which matches current settings). Once a redraw is forced,
  // these flags are cleared to indicate that a new draw should be initiated.
  BOOL  isTreeDrawInProgress;
  BOOL  isOverlayDrawInProgress;

  float  scrollWheelDelta;
}

// Initialises the instance-specific state after the view has been restored
// from the nib file (which invokes the generic initWithFrame: method).
- (void) postInitWithPathModelView:(ItemPathModelView *)pathModelView;

@property (nonatomic, readonly, strong) ItemPathModelView *pathModelView;
@property (nonatomic, readonly, strong) FileItem *treeInView;

- (NSRect) locationInViewForItem:(FileItem *)item onPath:(NSArray *)itemPath;
- (NSImage *)imageInViewForItem:(FileItem *)item onPath:(NSArray *)itemPath;

- (NSRect) locationInViewForItemAtEndOfPath:(NSArray *)itemPath;
- (NSImage *)imageInViewForItemAtEndOfPath:(NSArray *)itemPath;

@property (nonatomic, strong) TreeDrawerSettings *treeDrawerSettings;
@property (nonatomic, readonly) FileItemMapping *colorMapper;
@property (nonatomic, strong) FileItemTest *overlayTest;

// Property used during zoom animation.
@property (nonatomic) NSRect zoomBounds;

// Property used during animation
@property (nonatomic) NSRect pathEndRect;

@property (nonatomic) unsigned displayDepth;
@property (nonatomic) BOOL showEntireVolume;

@property (nonatomic, readonly, strong) TreeLayoutBuilder *layoutBuilder;

- (BOOL) validateAction:(SEL)action;

@property (nonatomic, readonly) BOOL canZoomIn;
@property (nonatomic, readonly) BOOL canZoomOut;
@property (nonatomic, readonly) BOOL canResetZoom;

@property (nonatomic, readonly) BOOL canMoveSelectionFocusUp;
@property (nonatomic, readonly) BOOL canMoveSelectionFocusDown;
@property (nonatomic, readonly) BOOL canResetSelectionFocus;

@property (nonatomic, readonly) BOOL canMoveDisplayFocusUp;
@property (nonatomic, readonly) BOOL canMoveDisplayFocusDown;
@property (nonatomic, readonly) BOOL canResetDisplayFocus;

- (void) zoomIn:(id)sender;
- (void) zoomOut:(id)sender;
- (void) resetZoom:(id)sender;

- (void) moveSelectionFocusUp:(id)sender;
- (void) moveSelectionFocusDown:(id)sender;
- (void) resetSelectionFocus:(id)sender;

- (void) moveDisplayFocusUp:(id)sender;
- (void) moveDisplayFocusDown:(id)sender;
- (void) resetDisplayFocus:(id)sender;

@end
